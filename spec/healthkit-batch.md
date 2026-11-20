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
  sleep?: Sleep[],
  samples?: Sample[],
  hourly?: Hourly[],
  activity?: ActivityDay[],
  deleted?: { kind: "workout" | "sleep" | "sample", uuid: string }[],
}
```

Times are RFC 3339 UTC (`2026-11-18T21:17:03.120Z`). `source` is the app or device that wrote a
record into HealthKit: `{ name: string, bundle_id: string, version?: string, device?: string }`.
`metadata` is HealthKit's, with every key kept: strings, numbers and booleans as they are, a
quantity as `"<value> <unit>"`, a date as RFC 3339.

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
}

Sleep = { uuid, start, end, stage: "inBed" | "asleepUnspecified" | "awake" | "asleepCore"
                                   | "asleepDeep" | "asleepREM", source, metadata? }

// sparse measurements, every sample: bodyMass (kg), bodyFatPercentage (%), leanBodyMass (kg),
// bodyMassIndex (count), height (m), restingHeartRate, walkingHeartRateAverage, respiratoryRate
// (count/min), heartRateVariabilitySDNN (ms), vo2Max (ml/kg·min), oxygenSaturation (%),
// bodyTemperature, appleSleepingWristTemperature (degC), bloodPressureSystolic,
// bloodPressureDiastolic (mmHg), dietaryWater (mL), mindfulSession (min; a category sample)
Sample = { uuid, type: string, start, end, value: number, unit: string, source, metadata? }

// dense measurements, one row per type and hour (HealthKit's merged statistics: the iPhone's and
// the Watch's steps aren't counted twice). Sums: stepCount (count), distanceWalkingRunning,
// distanceCycling (m), activeEnergyBurned, basalEnergyBurned (kcal), flightsClimbed (count),
// appleExerciseTime, appleStandTime (min). Ranges: heartRate (count/min) with min, avg, max.
// An hour is re-sent whole while it can still change (the last two days), so the latest wins.
Hourly = { type: string, hour: string /* start, UTC */, unit: string,
           sum?: number, min?: number, avg?: number, max?: number }

// the rings, one row per day (the device's calendar day), with that day's goals;
// re-sent whole for the last few days, the latest wins
ActivityDay = { day: string /* YYYY-MM-DD */, move_kcal?, move_goal_kcal?, exercise_min?,
                exercise_goal_min?, stand_h?, stand_goal_h? }
```

Keys, for storing a batch again without effect: workouts, sleep and samples by `uuid`; hourly by
`(type, hour)`; activity by `day`. A `deleted` entry removes what has that `uuid`.

## Versions

`schema` goes up only for a change an old receiver would misread. New optional fields, new
`type`s and new kinds of list don't change it: receivers keep what they don't know.
