// The kinds beyond workouts, sleep, samples, hourly statistics and rings (spec/healthkit-batch.md):
// category samples, correlations, ECGs, audiograms, heartbeat series, state of mind, GAD-7/PHQ-9,
// medications and doses, characteristics; and per workout, its minute-by-minute series and route.
// Each kind is read on its own: one that fails (not allowed, not on this iOS) doesn't stop the rest.
import CoreLocation
import Foundation
import HealthKit

extension HealthReader {
    static func uuid(_ o: HKObject) -> String { o.uuid.uuidString.lowercased() }
    static func src(_ s: HKSample) -> HealthSource { HealthTypes.source(s.sourceRevision, device: s.device) }
    static func md(_ s: HKObject) -> [String: JSONValue]? { s.metadata.map(HealthTypes.metadata) }
    static func deleted(_ kind: String, _ d: [HKDeletedObject]) -> [HealthDeleted]? {
        d.isEmpty ? nil : d.map { HealthDeleted(kind: kind, uuid: $0.uuid.uuidString.lowercased()) }
    }

    /// Everything after the core kinds; returns how many records it handed over.
    func runMore(now: Date) async -> Int {
        var n = 0
        for c in HealthTypes.categories {
            n += await soft(c.name) {
                try await self.anchored(key: "category.\(c.name)", predicate: .categorySample(type: HKCategoryType(c.id)), limit: 5000) { added, deleted in
                    var b = self.newBatch()
                    b.categories = added.map {
                        HealthCategory(uuid: Self.uuid($0), type: c.name, start: HealthTime.string($0.startDate), end: HealthTime.string($0.endDate),
                                       value: $0.value, source: Self.src($0), metadata: Self.md($0))
                    }
                    b.deleted = Self.deleted("category", deleted)
                    return b
                }
            }
        }
        for (id, name) in [(HKCorrelationTypeIdentifier.food, "food"), (.bloodPressure, "bloodPressure")] {
            n += await soft("correlation \(name)") {
                try await self.anchored(key: "correlation.\(name)", predicate: .correlation(type: HKCorrelationType(id)), limit: 2000) { added, deleted in
                    var b = self.newBatch()
                    b.correlations = added.map {
                        HealthCorrelation(uuid: Self.uuid($0), type: name, start: HealthTime.string($0.startDate), end: HealthTime.string($0.endDate),
                                          members: $0.objects.map(Self.uuid).sorted(), source: Self.src($0), metadata: Self.md($0))
                    }
                    b.deleted = Self.deleted("correlation", deleted)
                    return b
                }
            }
        }
        n += await soft("ecg") {
            try await self.anchored(key: "ecg", predicate: .electrocardiogram(), limit: 10) { added, deleted in
                var b = self.newBatch()
                var out: [HealthECG] = []
                for e in added { out.append(try await self.ecg(e)) }
                b.ecg = out
                b.deleted = Self.deleted("ecg", deleted)
                return b
            }
        }
        n += await soft("audiograms") {
            try await self.anchored(key: "audiograms", predicate: .audiogram(), limit: 500) { added, deleted in
                var b = self.newBatch()
                b.audiograms = added.map(Self.audiogram)
                b.deleted = Self.deleted("audiogram", deleted)
                return b
            }
        }
        n += await soft("heartbeats") {
            try await self.anchored(key: "heartbeats", predicate: .heartbeatSeries(), limit: 100) { added, deleted in
                var b = self.newBatch()
                var out: [HealthHeartbeats] = []
                for s in added {
                    var beats: [HealthHeartbeats.Beat] = []
                    for try await beat in HKHeartbeatSeriesQueryDescriptor(s).results(for: self.store) {
                        beats.append(.init(t: beat.timeIntervalSinceStart, gap: beat.precededByGap ? true : nil))
                    }
                    out.append(HealthHeartbeats(uuid: Self.uuid(s), start: HealthTime.string(s.startDate), end: HealthTime.string(s.endDate),
                                                beats: beats, source: Self.src(s)))
                }
                b.heartbeats = out
                b.deleted = Self.deleted("heartbeats", deleted)
                return b
            }
        }
        n += await soft("state of mind") {
            try await self.anchored(key: "stateOfMind", predicate: .stateOfMind(), limit: 2000) { added, deleted in
                var b = self.newBatch()
                b.state_of_mind = added.map(Self.stateOfMind)
                b.deleted = Self.deleted("state_of_mind", deleted)
                return b
            }
        }
        n += await soft("GAD-7") {
            try await self.anchored(key: "gad7", predicate: .gad7Assessment(), limit: 1000) { added, deleted in
                var b = self.newBatch()
                b.assessments = added.map {
                    HealthAssessment(uuid: Self.uuid($0), type: "GAD7", start: HealthTime.string($0.startDate), end: HealthTime.string($0.endDate),
                                     score: $0.score, risk: Self.named(["noneToMinimal", "mild", "moderate", "severe"], $0.risk.rawValue), answers: $0.answers.map(\.rawValue), source: Self.src($0))
                }
                b.deleted = Self.deleted("assessment", deleted)
                return b
            }
        }
        n += await soft("PHQ-9") {
            try await self.anchored(key: "phq9", predicate: .phq9Assessment(), limit: 1000) { added, deleted in
                var b = self.newBatch()
                b.assessments = added.map {
                    HealthAssessment(uuid: Self.uuid($0), type: "PHQ9", start: HealthTime.string($0.startDate), end: HealthTime.string($0.endDate),
                                     score: $0.score, risk: Self.named(["noneToMinimal", "mild", "moderate", "moderatelySevere", "severe"], $0.risk.rawValue), answers: $0.answers.map(\.rawValue), source: Self.src($0))
                }
                b.deleted = Self.deleted("assessment", deleted)
                return b
            }
        }
        if #available(iOS 26.0, *) {
            n += await soft("medications") { try await self.medications() }
        }
        n += await soft("characteristics") { try self.characteristics() }
        n += await soft("vision prescriptions") { try await self.visionPrescriptions() }
        n += await clinicalRecords()
        return n
    }

    /// Runs one kind; "no data" is nothing new, any other failure is noted (HealthState.lastReadError)
    /// and the next kind goes on.
    func soft(_ what: String, _ body: () async throws -> Int) async -> Int {
        do {
            return try await body()
        } catch let e as HKError where e.code == .errorNoData {
            return 0
        } catch {
            problems.append("\(what): \(error.localizedDescription)")
            return 0
        }
    }

    // MARK: workouts: statistics, activities, series, route

    /// Per-minute series during a workout: sums for cumulative types, min/avg/max for the rest.
    static let seriesTypes = ["heartRate", "activeEnergyBurned", "basalEnergyBurned", "stepCount", "distanceWalkingRunning",
                              "distanceCycling", "distanceSwimming", "swimmingStrokeCount", "distanceRowing", "distancePaddleSports",
                              "distanceDownhillSnowSports", "distanceCrossCountrySkiing", "distanceSkatingSports", "flightsClimbed",
                              "cyclingPower", "cyclingCadence", "cyclingSpeed", "runningPower", "runningSpeed", "physicalEffort"]
    /// Heart rate after a workout ends, a minute at a time (as heartRateRecovery).
    static let recoveryMinutes = 10

    static func stats(_ all: [HKQuantityType: HKStatistics]) -> [String: HealthWorkout.Stat]? {
        var out: [String: HealthWorkout.Stat] = [:]
        for (type, s) in all {
            guard let t = HealthTypes.byType[type] else { continue }
            let v = { (q: HKQuantity?) in q.flatMap { $0.is(compatibleWith: t.unit) ? $0.doubleValue(for: t.unit) : nil } }
            let stat = HealthWorkout.Stat(unit: t.label, sum: v(s.sumQuantity()), min: v(s.minimumQuantity()),
                                          avg: v(s.averageQuantity()), max: v(s.maximumQuantity()))
            if stat.sum ?? stat.avg ?? stat.min ?? stat.max != nil { out[t.name] = stat }
        }
        return out.isEmpty ? nil : out
    }

    static func activities(_ w: HKWorkout) -> [HealthWorkout.Activity]? {
        let acts = w.workoutActivities
        guard acts.count > 1 else { return nil } // one activity is the workout itself
        return acts.map { a in
            let events = a.workoutEvents.map {
                HealthWorkout.Event(type: HealthTypes.eventName($0.type), start: HealthTime.string($0.dateInterval.start),
                                    end: HealthTime.string($0.dateInterval.end))
            }
            let type = a.workoutConfiguration.activityType
            return HealthWorkout.Activity(
                uuid: a.uuid.uuidString.lowercased(), start: HealthTime.string(a.startDate), end: a.endDate.map(HealthTime.string),
                duration_s: a.duration, activity_type: type.rawValue, activity: HealthTypes.activityName(type),
                metadata: HealthTypes.metadata(a.metadata), stats: stats(a.allStatistics), events: events.isEmpty ? nil : events)
        }
    }

    /// A workout's series and route, for the batch that carries the workout.
    func extras(_ w: HKWorkout, now: Date) async -> (series: [HealthWorkoutSeries], routes: [HealthWorkoutRoute]) {
        let id = Self.uuid(w)
        var series: [HealthWorkoutSeries] = []
        let during = HKQuery.predicateForSamples(withStart: w.startDate, end: w.endDate)
        for name in Self.seriesTypes {
            guard let t = HealthTypes.byName[name] else { continue }
            do {
                series += try await minutes(of: t, named: name, from: w.startDate, to: w.endDate, predicate: during, workout: id)
            } catch {
                problems.append("\(name) during a workout: \(error.localizedDescription)")
            }
        }
        // the minutes after it, once they've passed
        let after = w.endDate.addingTimeInterval(Double(Self.recoveryMinutes) * 60)
        if after < now, let hr = HealthTypes.byType[HKQuantityType(.heartRate)] {
            let window = HKQuery.predicateForSamples(withStart: w.endDate, end: after)
            series += (try? await minutes(of: hr, named: "heartRateRecovery", from: w.endDate, to: after, predicate: window, workout: id)) ?? []
        }
        var routes: [HealthWorkoutRoute] = []
        do {
            let found = try await HKSampleQueryDescriptor(predicates: [.workoutRoute(HKQuery.predicateForObjects(from: w))], sortDescriptors: [])
                .result(for: store)
            for r in found {
                var points: [HealthRoutePoint] = []
                for try await l in HKWorkoutRouteQueryDescriptor(r).results(for: store) {
                    points.append(Self.point(l))
                }
                routes.append(HealthWorkoutRoute(workout: id, uuid: Self.uuid(r), points: points))
            }
        } catch {
            problems.append("route: \(error.localizedDescription)")
        }
        return (series, routes)
    }

    private func minutes(of t: HealthTypes.Typed, named name: String, from: Date, to: Date, predicate: NSPredicate,
                         workout: String) async throws -> [HealthWorkoutSeries] {
        let type = HKQuantityType(t.id)
        let sum = type.aggregationStyle == .cumulative
        let options: HKStatisticsOptions = sum ? .cumulativeSum : [.discreteMin, .discreteAverage, .discreteMax]
        let start = Calendar(identifier: .gregorian).dateInterval(of: .minute, for: from)?.start ?? from
        let collection = try await HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: predicate), options: options,
            anchorDate: start, intervalComponents: DateComponents(minute: 1)).result(for: store)
        var rows: [HealthWorkoutSeries] = []
        collection.enumerateStatistics(from: start, to: to) { s, _ in
            var row = HealthWorkoutSeries(workout: workout, type: name, minute: HealthTime.string(s.startDate), unit: t.label)
            if sum {
                guard let v = s.sumQuantity() else { return }
                row.sum = v.doubleValue(for: t.unit)
            } else {
                guard let mn = s.minimumQuantity(), let av = s.averageQuantity(), let mx = s.maximumQuantity() else { return }
                row.min = mn.doubleValue(for: t.unit)
                row.avg = av.doubleValue(for: t.unit)
                row.max = mx.doubleValue(for: t.unit)
            }
            rows.append(row)
        }
        return rows
    }

    static func point(_ l: CLLocation) -> HealthRoutePoint {
        let ok = { (v: Double) in v >= 0 ? v : nil } // CoreLocation's -1: not known
        return HealthRoutePoint(at: HealthTime.string(l.timestamp), lat: l.coordinate.latitude, lon: l.coordinate.longitude,
                                alt: l.verticalAccuracy >= 0 ? l.altitude : nil, speed: ok(l.speed), course: ok(l.course),
                                h_acc: ok(l.horizontalAccuracy), v_acc: ok(l.verticalAccuracy))
    }

    // MARK: the other kinds

    static let ecgClassification = [0: "notSet", 1: "sinusRhythm", 2: "atrialFibrillation", 3: "inconclusiveLowHeartRate",
                                    4: "inconclusiveHighHeartRate", 5: "inconclusivePoorReading", 6: "inconclusiveOther",
                                    100: "unrecognized"]
    static let ecgSymptoms = [0: "notSet", 1: "none", 2: "present"]

    private func ecg(_ e: HKElectrocardiogram) async throws -> HealthECG {
        let uv = HKUnit.voltUnit(with: .micro)
        var volts: [Double] = []
        for try await m in HKElectrocardiogramQueryDescriptor(e).results(for: store) {
            if let q = m.quantity(for: .appleWatchSimilarToLeadI) { volts.append(q.doubleValue(for: uv)) }
        }
        return HealthECG(
            uuid: Self.uuid(e), start: HealthTime.string(e.startDate), end: HealthTime.string(e.endDate),
            classification: Self.ecgClassification[e.classification.rawValue] ?? "\(e.classification.rawValue)",
            symptoms: Self.ecgSymptoms[e.symptomsStatus.rawValue] ?? "\(e.symptomsStatus.rawValue)",
            average_hr: e.averageHeartRate?.doubleValue(for: .count().unitDivided(by: .minute())),
            sampling_hz: e.samplingFrequency?.doubleValue(for: .hertz()), count: e.numberOfVoltageMeasurements,
            source: Self.src(e), metadata: Self.md(e), voltages_uv: volts.isEmpty ? nil : volts)
    }

    static func audiogram(_ a: HKAudiogramSample) -> HealthAudiogram {
        let db = HKUnit.decibelHearingLevel()
        let points = a.sensitivityPoints.map { p in
            var left: Double?, right: Double?
            if #available(iOS 18.1, *) {
                for t in p.tests where t.type == .air && !t.masked {
                    if t.side == .left { left = t.sensitivity.doubleValue(for: db) } else { right = t.sensitivity.doubleValue(for: db) }
                }
            } else {
                left = p.leftEarSensitivity?.doubleValue(for: db)
                right = p.rightEarSensitivity?.doubleValue(for: db)
            }
            return HealthAudiogram.Point(hz: p.frequency.doubleValue(for: .hertz()), left_db: left, right_db: right)
        }
        return HealthAudiogram(uuid: uuid(a), start: HealthTime.string(a.startDate), end: HealthTime.string(a.endDate),
                               points: points, source: src(a), metadata: md(a))
    }

    static let moodLabels = ["amazed", "amused", "angry", "anxious", "ashamed", "brave", "calm", "content", "disappointed",
                             "discouraged", "disgusted", "embarrassed", "excited", "frustrated", "grateful", "guilty", "happy",
                             "hopeless", "irritated", "jealous", "joyful", "lonely", "passionate", "peaceful", "proud", "relieved",
                             "sad", "scared", "stressed", "surprised", "worried", "annoyed", "confident", "drained", "hopeful",
                             "indifferent", "overwhelmed", "satisfied"]
    static let moodAssociations = ["community", "currentEvents", "dating", "education", "family", "fitness", "friends", "health",
                                   "hobbies", "identity", "money", "partner", "selfCare", "spirituality", "tasks", "travel", "work",
                                   "weather"]
    static let valenceClasses = ["veryUnpleasant", "unpleasant", "slightlyUnpleasant", "neutral", "slightlyPleasant", "pleasant",
                                 "veryPleasant"]

    /// HealthKit's 1-based enum raw value as its name (the number itself if newer than this list).
    static func named(_ names: [String], _ raw: Int) -> String { names.indices.contains(raw - 1) ? names[raw - 1] : "\(raw)" }

    static func stateOfMind(_ s: HKStateOfMind) -> HealthStateOfMind {
        HealthStateOfMind(uuid: uuid(s), start: HealthTime.string(s.startDate), end: HealthTime.string(s.endDate),
                          kind: s.kind == .dailyMood ? "dailyMood" : "momentaryEmotion", valence: s.valence,
                          classification: named(valenceClasses, s.valenceClassification.rawValue),
                          labels: s.labels.map { named(moodLabels, $0.rawValue) },
                          associations: s.associations.map { named(moodAssociations, $0.rawValue) },
                          source: src(s), metadata: md(s))
    }

    static let doseStatus = ["notInteracted", "notificationNotSent", "snoozed", "taken", "skipped", "notLogged"]

    /// The medication list (sent when it changes) and every dose. Needs the per-medication
    /// permission (HealthSync.authorize asks); without it there's nothing to read.
    @available(iOS 26.0, *)
    private func medications() async throws -> Int {
        let meds = try await HKUserAnnotatedMedicationQueryDescriptor().result(for: store)
        func key(_ m: HKMedicationConcept) -> String {
            let c = m.relatedCodings.sorted { ($0.system, $0.code) < ($1.system, $1.code) }.first
            return c.map { "\($0.system)|\($0.code)" } ?? m.displayText
        }
        let list = meds.map { m in
            HealthMedication(id: key(m.medication), name: m.medication.displayText, form: m.medication.generalForm.rawValue,
                             nickname: m.nickname, archived: m.isArchived, scheduled: m.hasSchedule,
                             codings: m.medication.relatedCodings.map { .init(system: $0.system, code: $0.code, version: $0.version) }
                                 .sorted { ($0.system, $0.code) < ($1.system, $1.code) })
        }.sorted { $0.id < $1.id }
        var n = 0
        if list != state.medications {
            var b = newBatch()
            b.medications = list
            try emit(b)
            state.medications = list
            try persist(state)
            n += list.count
        }
        let idOf = { (c: HKHealthConceptIdentifier) in meds.first { $0.medication.identifier == c }.map { key($0.medication) } ?? "unknown" }
        n += try await anchored(key: "doses", predicate: .sample(type: HKObjectType.medicationDoseEventType()), limit: 2000) { added, deleted in
            var b = self.newBatch()
            b.doses = added.compactMap { $0 as? HKMedicationDoseEvent }.map { d in
                HealthDose(uuid: Self.uuid(d), start: HealthTime.string(d.startDate), end: HealthTime.string(d.endDate),
                           medication: idOf(d.medicationConceptIdentifier), status: Self.named(Self.doseStatus, d.logStatus.rawValue),
                           unit: d.unit.unitString, scheduled_at: d.scheduledDate.map(HealthTime.string), dose: d.doseQuantity,
                           scheduled_dose: d.scheduledDoseQuantity, as_needed: d.scheduleType == .asNeeded ? true : nil,
                           source: Self.src(d))
            }
            b.deleted = Self.deleted("dose", deleted)
            return b
        }
        return n
    }

    /// Date of birth, biological sex, …: sent when they change (raw values, but for sex and blood type).
    private func characteristics() throws -> Int {
        var out: [HealthCharacteristic] = []
        let sexes = [1: "female", 2: "male", 3: "other"]
        let bloods = [1: "A+", 2: "A-", 3: "B+", 4: "B-", 5: "AB+", 6: "AB-", 7: "O+", 8: "O-"]
        if let v = try? store.biologicalSex().biologicalSex.rawValue, let s = sexes[v] { out.append(.init(type: "biologicalSex", value: s)) }
        if let v = try? store.bloodType().bloodType.rawValue, let s = bloods[v] { out.append(.init(type: "bloodType", value: s)) }
        if let c = try? store.dateOfBirthComponents(), let y = c.year, let m = c.month, let d = c.day {
            out.append(.init(type: "dateOfBirth", value: String(format: "%04d-%02d-%02d", y, m, d)))
        }
        if let v = try? store.fitzpatrickSkinType().skinType.rawValue, v > 0 { out.append(.init(type: "fitzpatrickSkinType", value: "\(v)")) }
        if let v = try? store.wheelchairUse().wheelchairUse.rawValue, v > 0 { out.append(.init(type: "wheelchairUse", value: v == 2 ? "yes" : "no")) }
        if let v = try? store.activityMoveMode().activityMoveMode.rawValue {
            out.append(.init(type: "activityMoveMode", value: v == 2 ? "appleMoveTime" : "activeEnergy"))
        }
        guard out != state.characteristics, !out.isEmpty else { return 0 }
        var b = newBatch()
        b.characteristics = out
        try emit(b)
        state.characteristics = out
        try persist(state)
        return out.count
    }
}

// MARK: shared one by one, or behind the health-records entitlement

extension HealthReader {
    /// Glasses and contacts prescriptions the per-item sheet (authorize) shared.
    func visionPrescriptions() async throws -> Int {
        try await anchored(key: "vision", predicate: .visionPrescription(), limit: 200) { added, deleted in
            var b = self.newBatch()
            b.vision_prescriptions = added.map(Self.vision)
            b.deleted = Self.deleted("vision_prescription", deleted)
            return b
        }
    }

    static func vision(_ p: HKVisionPrescription) -> HealthVisionPrescription {
        let diopter = HKUnit.diopter(), deg = HKUnit.degreeAngle(), mm = HKUnit.meterUnit(with: .milli)
        let prismUnit = HKUnit.prismDiopter()
        func v(_ q: HKQuantity?, _ u: HKUnit) -> Double? { q.flatMap { $0.is(compatibleWith: u) ? $0.doubleValue(for: u) : nil } }
        func base(_ b: HKPrismBase) -> String {
            switch b {
            case .up: "up"
            case .down: "down"
            case .in: "in"
            case .out: "out"
            default: "none"
            }
        }
        func lens(_ l: HKLensSpecification?) -> HealthVisionPrescription.Lens? {
            guard let l else { return nil }
            var out = HealthVisionPrescription.Lens(sphere: v(l.sphere, diopter) ?? 0, cylinder: v(l.cylinder, diopter),
                                                    axis: v(l.axis, deg), add: v(l.addPower, diopter))
            if let g = l as? HKGlassesLensSpecification {
                out.vertex_mm = v(g.vertexDistance, mm)
                out.far_pd_mm = v(g.farPupillaryDistance, mm)
                out.near_pd_mm = v(g.nearPupillaryDistance, mm)
                if let p = g.prism {
                    out.prism = .init(amount: v(p.amount, prismUnit) ?? 0, angle: v(p.angle, deg) ?? 0,
                                      vertical: v(p.verticalAmount, prismUnit) ?? 0, horizontal: v(p.horizontalAmount, prismUnit) ?? 0,
                                      vertical_base: base(p.verticalBase), horizontal_base: base(p.horizontalBase))
                }
            }
            if let c = l as? HKContactsLensSpecification {
                out.base_curve_mm = v(c.baseCurve, mm)
                out.diameter_mm = v(c.diameter, mm)
            }
            return out
        }
        var out = HealthVisionPrescription(uuid: uuid(p), type: p.prescriptionType == .contacts ? "contacts" : "glasses",
                                           issued: HealthTime.string(p.dateIssued), expires: p.expirationDate.map(HealthTime.string),
                                           source: src(p), metadata: md(p))
        if let g = p as? HKGlassesPrescription {
            out.right = lens(g.rightEye)
            out.left = lens(g.leftEye)
        } else if let c = p as? HKContactsPrescription {
            out.brand = c.brand
            out.right = lens(c.rightEye)
            out.left = lens(c.leftEye)
        }
        return out
    }

    /// Records from providers linked in Health (needs the health-records entitlement and its sheet).
    func clinicalRecords() async -> Int {
        var n = 0
        for (id, name) in HealthTypes.clinical {
            guard let type = HKClinicalType.clinicalType(forIdentifier: id) else { continue }
            n += await soft("clinical \(name)") {
                try await self.anchored(key: "clinical.\(name)", predicate: .clinicalRecord(type: type), limit: 500) { added, deleted in
                    var b = self.newBatch()
                    b.clinical_records = added.map { r in
                        let f = r.fhirResource
                        return HealthClinicalRecord(
                            uuid: Self.uuid(r), type: name, name: r.displayName, start: HealthTime.string(r.startDate),
                            end: HealthTime.string(r.endDate), fhir_type: f?.resourceType.rawValue, fhir_id: f?.identifier,
                            fhir_version: f?.fhirVersion.stringRepresentation, fhir_source: f?.sourceURL?.absoluteString,
                            fhir: f.flatMap { String(data: $0.data, encoding: .utf8) }, source: Self.src(r))
                    }
                    b.deleted = Self.deleted("clinical_record", deleted)
                    return b
                }
            }
        }
        return n
    }
}
