# HealthKit batches, version 1

The iOS app reads HealthKit (`ios/App/Health/`) and, when a push URL is set (⋯ → Sync & ledgers →
Health), POSTs what's new as batches to any endpoint that speaks this format. The homelab's is the
collectors repo's `healthkit` source.

## Transport

```
POST <url>                         e.g. https://healthkit.example/ingest
Authorization: Bearer <token>      one token per device; the receiver maps it to an account
Content-Type: application/json
Content-Encoding: gzip
```

On a metered network (cellular, Low Data Mode) one sync sends at most 5 MB, oldest first; the
rest waits for Wi-Fi, where a sync keeps reading and sending until history is in. The phone reads
ahead only while its outbox holds under 32 MB, so a first sync's backfill comes a slice at a time.

Any 2xx means the batch is stored; the app then deletes its copy. Anything else (or no answer) and
the app keeps it and tries again on its next sync, in order. So a receiver may see a batch twice:
everything in it is keyed so that storing it again changes nothing.

## Body

```ts
{
  schema: 1,
  batch_id: string,                // uuid, new per batch
  created_at: string,              // RFC 3339 UTC
  app: string,                     // "ledger-ios <version>"
  device: { id: string,            // random uuid, kept for the life of the install
            name: string,          // "iPhone"
            model: string,         // "iPhone16,1"
            os: string },          // "27.2"
  time_zone: string,               // IANA, the device's when the batch was made

  // each list is optional; a batch holds one kind's next chunk (the first sync backfills all history)
  workouts?: Workout[],
  workout_series?: WorkoutSeries[],   // with the workouts they belong to, in the same batch
  workout_routes?: WorkoutRoute[],    // likewise
  sleep?: Sleep[],
  samples?: Sample[],
  hourly?: Hourly[],
  activity?: ActivityDay[],
  categories?: Category[],
  correlations?: Correlation[],
  ecg?: ECG[],
  audiograms?: Audiogram[],
  heartbeats?: Heartbeats[],
  state_of_mind?: StateOfMind[],
  assessments?: Assessment[],
  medications?: Medication[],         // the whole list, when it changes
  doses?: Dose[],
  characteristics?: Characteristic[], // all of them, when they change
  deleted?: { kind: "workout" | "sleep" | "sample" | "category" | "correlation" | "ecg" | "audiogram"
                  | "heartbeats" | "state_of_mind" | "assessment" | "dose", uuid: string }[],
}
```

The app reads everything HealthKit lets an app read: every quantity and category type in the iOS
SDK (`ios/App/Health/HealthCatalog.swift`, generated from its `HKTypeIdentifiers.h`), workouts with
their series and routes, ECGs, audiograms, heartbeat series, state of mind, GAD-7 and PHQ-9,
medications and doses (iOS 26; shared one medication at a time on a sheet of their own) and
characteristics. Not read: clinical records and vision prescriptions (each needs its own
entitlement or per-item sheet). A type newer than the phone's iOS is skipped.

Times are RFC 3339 UTC (`2026-11-18T21:17:03.120Z`). `source` is the app or device that wrote a
record into HealthKit: `{ name: string, bundle_id: string, version?: string, device?: string }`.
`metadata` is HealthKit's, with every key kept: strings, numbers and booleans as they are, a
quantity as `"<value> <unit>"`, a date as RFC 3339. Type names are HealthKit's identifiers without
their prefix, first letter lowercased (`HKQuantityTypeIdentifierBodyMass` → `bodyMass`,
`HKCategoryTypeIdentifierHandwashingEvent` → `handwashingEvent`, `VO2Max` → `vo2Max`). Units are
HealthKit's unit strings, each type's canonical unit (rates per minute, not second).

```ts
Workout = {
  uuid, start, end, duration_s: number,
  activity_type: number,            // HKWorkoutActivityType raw value
  activity: string,                 // its name: "functionalStrengthTraining", "running", …
  source, metadata,                 // a titled workout (Trainerize) has metadata.HKWorkoutBrandName
  energy_kcal?: number,             // active energy
  distance_m?: number,
  heart_rate?: { min: number, avg: number, max: number },   // count/min
  events?: { type: string, start: string, end: string }[],  // laps, segments, pauses
  stats?: { [type]: Stat },         // every statistic HealthKit keeps for the workout
  activities?: {                    // a multisport workout's parts (swim, bike, run)
    uuid, start, end?, duration_s, activity_type, activity, metadata, stats?, events? }[],
}
Stat = { unit: string, sum?: number, min?: number, avg?: number, max?: number }

// a minute at a time during the workout, from every source (HealthKit's merged statistics):
// sums for cumulative types (activeEnergyBurned, stepCount, distance…), min/avg/max for the rest
// (heartRate, cyclingPower, runningSpeed, physicalEffort, …); "heartRateRecovery" is heart rate
// in the 10 minutes after it ends
WorkoutSeries = { workout: uuid, type: string, minute: string, unit: string,
                  sum?: number, min?: number, avg?: number, max?: number }

WorkoutRoute = { workout: uuid, uuid: string /* the route sample */,
                 points: { at, lat, lon, alt?, speed? /* m/s */, course? /* degrees */,
                           h_acc?, v_acc? /* m */ }[] }

Sleep = { uuid, start, end, stage: "inBed" | "asleepUnspecified" | "awake" | "asleepCore"
                                   | "asleepDeep" | "asleepREM", source, metadata? }

// every sample of every quantity type (dense ones too, with their own device and interval; the
// hourly statistics below are the merged totals): heart (heartRate, restingHeartRate,
// heartRateVariabilitySDNN, vo2Max, …), energy, steps, distances, mobility (walkingSpeed, walkingStepLength,
// walkingAsymmetryPercentage, stairAscentSpeed, sixMinuteWalkTestDistance, …), running metrics,
// audio exposure (dBASPL), physicalEffort, nutrition (dietary*: g, kcal, mL), and the rest
Sample = { uuid, type: string, start, end, value: number, unit: string, source, metadata? }

// dense types, also one row per type and hour (HealthKit's merged statistics: the iPhone's and the
// Watch's steps aren't counted twice). Sums: stepCount, the distances, activeEnergyBurned,
// basalEnergyBurned, flightsClimbed, appleExerciseTime, appleStandTime, appleMoveTime,
// timeInDaylight, swimmingStrokeCount, pushCount, nikeFuel. Ranges (min, avg, max): heartRate,
// cyclingCadence, cyclingPower, cyclingSpeed. An hour is re-sent whole while it can still
// change (the last two days), so the latest wins.
Hourly = { type: string, hour: string /* start, UTC */, unit: string,
           sum?: number, min?: number, avg?: number, max?: number }

// the rings, one row per day (the device's calendar day), with that day's goals;
// re-sent whole for the last few days, the latest wins
ActivityDay = { day: string /* YYYY-MM-DD */, move_kcal?, move_goal_kcal?, exercise_min?,
                exercise_goal_min?, stand_h?, stand_goal_h? }

// every category type but sleep: appleStandHour, handwashingEvent, toothbrushingEvent,
// mindfulSession, high/low/irregular heart rate and audio exposure notifications, symptoms
// (headache, …), cycle tracking, sexualActivity, sleepApneaEvent, …; value is HealthKit's raw
// HKCategoryValue… (0 when the type has none; symptoms: 0 present, 1 not present, 2 mild, 3
// moderate, 4 severe)
Category = { uuid, type: string, start, end, value: number, source, metadata? }

// "food" (a meal: its dietary samples, metadata.HKFoodType its name) or "bloodPressure"
Correlation = { uuid, type: "food" | "bloodPressure", start, end, members: uuid[], source, metadata? }

ECG = { uuid, start, end, classification: "sinusRhythm" | "atrialFibrillation" | "inconclusive…"
        | "unrecognized" | "notSet", symptoms: "none" | "present" | "notSet", average_hr?: number,
        sampling_hz?: number, count: number, source, metadata?,
        voltages_uv?: number[] /* lead I, µV, one every 1/sampling_hz s */ }

Audiogram = { uuid, start, end, points: { hz, left_db?, right_db? /* dB HL */ }[], source, metadata? }

// the beat-to-beat times behind an HRV reading: seconds since start; gap: beats missed before it
Heartbeats = { uuid, start, end, beats: { t: number, gap?: true }[], source }

StateOfMind = { uuid, start, end, kind: "momentaryEmotion" | "dailyMood", valence: number /* -1…1 */,
                classification: "veryUnpleasant" … "veryPleasant", labels: string[] /* "calm", … */,
                associations: string[] /* "work", … */, source, metadata? }

Assessment = { uuid, type: "GAD7" | "PHQ9", start, end, score: number,
               risk: "noneToMinimal" | "mild" | "moderate" | "moderatelySevere" | "severe",
               answers: number[], source }

// id: "<coding system>|<code>" (RxNorm where Health has it), else the medication's name
Medication = { id, name, form: string, nickname?, archived: boolean, scheduled: boolean,
               codings: { system, code, version? }[] }
Dose = { uuid, start, end, medication: string /* Medication.id */, status: "taken" | "skipped"
         | "snoozed" | "notInteracted" | "notificationNotSent" | "notLogged", unit: string,
         dose?: number, scheduled_dose?: number, scheduled_at?: string, as_needed?: true, source }

// biologicalSex ("female" | "male" | "other"), bloodType ("A+", …), dateOfBirth (YYYY-MM-DD),
// fitzpatrickSkinType (1–6), wheelchairUse ("yes" | "no"), activityMoveMode
Characteristic = { type: string, value: string }
```

Keys, for storing a batch again without effect: anything with a `uuid` by it (a route by its
workout and each point's `at`); hourly by `(type, hour)`; activity by `day`; workout series by
`(workout, type, minute)`; medications by `id`; characteristics by `type`. A `deleted` entry
removes what has that `uuid`.

## Versions

`schema` goes up only for a change an old receiver would misread. New optional fields, new
`type`s and new kinds of list don't change it: receivers keep what they don't know.
