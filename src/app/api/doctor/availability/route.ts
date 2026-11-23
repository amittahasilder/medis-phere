
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

// Verify active and approved doctor
async function requireVerifiedDoctor(): Promise<
  { userId: string; doctorProfileId: string } | { error: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("medisphere_token")?.value;

  if (!token) {
    return {
      error: NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 },
      ),
    };
  }

  let decoded;

  try {
    decoded = verifyToken(token);
  } catch {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid or expired session" },
        { status: 401 },
      ),
    };
  }

  if (typeof decoded === "string" || typeof decoded.userId !== "string") {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid session" },
        { status: 401 },
      ),
    };
  }

  const result = await pool.query(
    `SELECT
       u.id AS user_id,
       dp.id AS doctor_profile_id
     FROM users u
     INNER JOIN doctor_profiles dp ON dp.user_id = u.id
     WHERE u.id = $1
       AND u.role = 'DOCTOR'
       AND u.is_active = TRUE
       AND dp.is_verified = TRUE
       AND dp.application_status = 'APPROVED'
     LIMIT 1`,
    [decoded.userId],
  );

  if (result.rows.length === 0) {
    return {
      error: NextResponse.json(
        { success: false, message: "Verified doctor access only" },
        { status: 403 },
      ),
    };
  }

  return {
    userId: result.rows[0].user_id,
    doctorProfileId: result.rows[0].doctor_profile_id,
  };
}

// Convert HH:MM into minutes
function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// GET: View own weekly availability
export async function GET() {
  try {
    const auth = await requireVerifiedDoctor();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT
         id,
         day_of_week,
         start_time,
         end_time,
         slot_duration_minutes,
         is_active,
         created_at,
         updated_at
       FROM doctor_availability
       WHERE doctor_profile_id = $1
       ORDER BY day_of_week, start_time`,
      [auth.doctorProfileId],
    );

    const doctorResult = await pool.query(
      `SELECT is_available
       FROM doctor_profiles
       WHERE id = $1`,
      [auth.doctorProfileId],
    );

    return NextResponse.json({
      success: true,
      message: "Doctor availability retrieved successfully",
      is_available: doctorResult.rows[0].is_available,
      schedule: result.rows,
    });
  } catch (error) {
    console.error("Doctor availability GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve availability" },
      { status: 500 },
    );
  }
}

// PUT: Replace the doctor's complete weekly schedule
export async function PUT(request: Request) {
  let client: PoolClient | undefined;

  try {
    const auth = await requireVerifiedDoctor();

    if ("error" in auth) {
      return auth.error;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Array.isArray((body as Record<string, unknown>).schedule)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "A schedule array is required",
        },
        { status: 400 },
      );
    }

    const schedule = (body as { schedule: unknown[] }).schedule;

    if (schedule.length > 42) {
      return NextResponse.json(
        { success: false, message: "Maximum 42 schedule entries allowed" },
        { status: 400 },
      );
    }

    const validatedSchedule: Array<{
      day: number;
      start: string;
      end: string;
      duration: number;
      active: boolean;
    }> = [];

    for (const item of schedule) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return NextResponse.json(
          { success: false, message: "Invalid schedule entry" },
          { status: 400 },
        );
      }

      const entry = item as Record<string, unknown>;

      const day = entry.day_of_week;
      const start = entry.start_time;
      const end = entry.end_time;
      const duration =
        entry.slot_duration_minutes === undefined
          ? 30
          : entry.slot_duration_minutes;
      const active = entry.is_active === undefined ? true : entry.is_active;

      if (
        typeof day !== "number" ||
        !Number.isInteger(day) ||
        day < 0 ||
        day > 6
      ) {
        return NextResponse.json(
          { success: false, message: "day_of_week must be between 0 and 6" },
          { status: 400 },
        );
      }

      const validTime =
        typeof start === "string" &&
        typeof end === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(start) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(end);

      if (!validTime || timeToMinutes(end) <= timeToMinutes(start)) {
        return NextResponse.json(
          { success: false, message: "Invalid start_time or end_time" },
          { status: 400 },
        );
      }

      if (
        typeof duration !== "number" ||
        !Number.isInteger(duration) ||
        duration < 10 ||
        duration > 180
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "Slot duration must be between 10 and 180 minutes",
          },
          { status: 400 },
        );
      }

      if (typeof active !== "boolean") {
        return NextResponse.json(
          { success: false, message: "is_active must be true or false" },
          { status: 400 },
        );
      }

      validatedSchedule.push({
        day,
        start,
        end,
        duration,
        active,
      });
    }

    // Prevent overlapping active schedules on the same day
    for (let day = 0; day <= 6; day++) {
      const dayEntries = validatedSchedule
        .filter((item) => item.day === day && item.active)
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

      for (let i = 1; i < dayEntries.length; i++) {
        if (
          timeToMinutes(dayEntries[i].start) <
          timeToMinutes(dayEntries[i - 1].end)
        ) {
          return NextResponse.json(
            {
              success: false,
              message: `Overlapping schedule entries on day ${day}`,
            },
            { status: 400 },
          );
        }
      }
    }

    // Save the complete schedule transactionally
    client = await pool.connect();

    await client.query("BEGIN");

    const doctorLock = await client.query(
      `SELECT id
       FROM doctor_profiles
       WHERE id = $1
         AND is_verified = TRUE
         AND application_status = 'APPROVED'
       FOR UPDATE`,
      [auth.doctorProfileId],
    );

    if (doctorLock.rows.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { success: false, message: "Verified doctor profile not found" },
        { status: 403 },
      );
    }

    await client.query(
      `DELETE FROM doctor_availability
       WHERE doctor_profile_id = $1`,
      [auth.doctorProfileId],
    );

    const savedSchedule = [];

    for (const entry of validatedSchedule) {
      const result = await client.query(
        `INSERT INTO doctor_availability (
          doctor_profile_id,
          day_of_week,
          start_time,
          end_time,
          slot_duration_minutes,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          day_of_week,
          start_time,
          end_time,
          slot_duration_minutes,
          is_active`,
        [
          auth.doctorProfileId,
          entry.day,
          entry.start,
          entry.end,
          entry.duration,
          entry.active,
        ],
      );

      savedSchedule.push(result.rows[0]);
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Doctor weekly schedule saved successfully",
      schedule: savedSchedule,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    console.error("Doctor availability PUT error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to save doctor schedule" },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}

// PATCH: Turn consultation availability ON or OFF
export async function PATCH(request: Request) {
  let client: PoolClient | undefined;

  try {
    const auth = await requireVerifiedDoctor();

    if ("error" in auth) {
      return auth.error;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).is_available !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, message: "is_available must be true or false" },
        { status: 400 },
      );
    }

    const isAvailable = (body as { is_available: boolean }).is_available;

    client = await pool.connect();

    await client.query("BEGIN");

    await client.query(
      `SELECT id
       FROM doctor_profiles
       WHERE id = $1
       FOR UPDATE`,
      [auth.doctorProfileId],
    );

    if (isAvailable) {
      const scheduleResult = await client.query(
        `SELECT EXISTS (
           SELECT 1
           FROM doctor_availability
           WHERE doctor_profile_id = $1
             AND is_active = TRUE
         ) AS has_schedule`,
        [auth.doctorProfileId],
      );

      if (!scheduleResult.rows[0].has_schedule) {
        await client.query("ROLLBACK");

        return NextResponse.json(
          {
            success: false,
            message:
              "Add at least one active schedule before enabling availability",
          },
          { status: 400 },
        );
      }
    }

    const result = await client.query(
      `UPDATE doctor_profiles
       SET is_available = $2,
           updated_at = NOW()
       WHERE id = $1
         AND is_verified = TRUE
         AND application_status = 'APPROVED'
       RETURNING is_available`,
      [auth.doctorProfileId, isAvailable],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { success: false, message: "Verified doctor profile not found" },
        { status: 403 },
      );
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: isAvailable
        ? "Doctor is now available for consultations"
        : "Doctor consultation availability turned off",
      is_available: result.rows[0].is_available,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    console.error("Doctor availability PATCH error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to update availability" },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
