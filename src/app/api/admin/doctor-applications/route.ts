

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import type { PoolClient } from "pg";

// Verify that the current user is an active ADMIN
async function requireAdmin(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("medisphere_token")?.value;

  if (!token) {
    return {
      error: NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 }
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
        { status: 401 }
      ),
    };
  }

  if (
    typeof decoded === "string" ||
    typeof decoded.userId !== "string"
  ) {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid session" },
        { status: 401 }
      ),
    };
  }

  const result = await pool.query(
    `SELECT id, role, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [decoded.userId]
  );

  const user = result.rows[0];

  if (!user || !user.is_active) {
    return {
      error: NextResponse.json(
        { success: false, message: "Account not available" },
        { status: 401 }
      ),
    };
  }

  if (user.role !== "ADMIN") {
    return {
      error: NextResponse.json(
        { success: false, message: "Admin access only" },
        { status: 403 }
      ),
    };
  }

  return { userId: user.id };
}

// GET: View pending doctor applications
export async function GET() {
  try {
    const auth = await requireAdmin();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT
        dp.id AS application_id,
        dp.user_id,
        u.full_name,
        u.email,
        u.phone,
        dp.specialization,
        dp.qualification,
        dp.medical_license_number,
        dp.experience_years,
        dp.consultation_fee,
        dp.bio,
        dp.clinic_name,
        dp.clinic_address,
        dp.application_status,
        dp.created_at
       FROM doctor_profiles dp
       INNER JOIN users u ON u.id = dp.user_id
       WHERE dp.application_status = 'PENDING'
         AND u.is_active = TRUE
       ORDER BY dp.created_at ASC
       LIMIT 100`
    );

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      applications: result.rows,
    });
  } catch (error) {
    console.error("Admin doctor applications GET error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to retrieve applications",
      },
      { status: 500 }
    );
  }
}

// PATCH: Approve or reject a pending doctor application
export async function PATCH(request: Request) {
  let client: PoolClient | undefined;

  try {
    const auth = await requireAdmin();

    if ("error" in auth) {
      return auth.error;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid request data" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const applicationId = input.application_id;

    const decision =
      typeof input.decision === "string"
        ? input.decision.trim().toUpperCase()
        : "";

    if (
      typeof applicationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        applicationId
      )
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid application ID" },
        { status: 400 }
      );
    }

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return NextResponse.json(
        {
          success: false,
          message: "Decision must be APPROVED or REJECTED",
        },
        { status: 400 }
      );
    }

    let rejectionReason: string | null = null;

    if (decision === "REJECTED") {
      if (typeof input.rejection_reason !== "string") {
        return NextResponse.json(
          {
            success: false,
            message: "A rejection reason is required",
          },
          { status: 400 }
        );
      }

      rejectionReason = input.rejection_reason.trim();

      if (!rejectionReason || rejectionReason.length > 2000) {
        return NextResponse.json(
          {
            success: false,
            message: "Rejection reason must be 1-2000 characters",
          },
          { status: 400 }
        );
      }
    }

    client = await pool.connect();

    await client.query("BEGIN");

    // Lock application to prevent simultaneous reviews
    const applicationResult = await client.query(
      `SELECT id, user_id, application_status
       FROM doctor_profiles
       WHERE id = $1
       FOR UPDATE`,
      [applicationId]
    );

    const application = applicationResult.rows[0];

    if (!application) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        { success: false, message: "Application not found" },
        { status: 404 }
      );
    }

    if (application.application_status !== "PENDING") {
      await client.query("ROLLBACK");

      return NextResponse.json(
        {
          success: false,
          message: "This application has already been reviewed",
        },
        { status: 409 }
      );
    }

    // Approve application
    if (decision === "APPROVED") {
      const userUpdate = await client.query(
        `UPDATE users
         SET role = 'DOCTOR',
             updated_at = NOW()
         WHERE id = $1
           AND is_active = TRUE
         RETURNING id`,
        [application.user_id]
      );

      if (userUpdate.rowCount !== 1) {
        await client.query("ROLLBACK");

        return NextResponse.json(
          {
            success: false,
            message: "Applicant account is not active",
          },
          { status: 409 }
        );
      }

      await client.query(
        `UPDATE doctor_profiles
         SET application_status = 'APPROVED',
             is_verified = TRUE,
             is_available = FALSE,
             reviewed_by = $2,
             reviewed_at = NOW(),
             rejection_reason = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [applicationId, auth.userId]
      );
    }

    // Reject application
    if (decision === "REJECTED") {
      await client.query(
        `UPDATE doctor_profiles
         SET application_status = 'REJECTED',
             is_verified = FALSE,
             is_available = FALSE,
             reviewed_by = $2,
             reviewed_at = NOW(),
             rejection_reason = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [applicationId, auth.userId, rejectionReason]
      );
    }

    // Record admin decision in audit logs
    await client.query(
      `INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        description,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        auth.userId,
        `DOCTOR_APPLICATION_${decision}`,
        "doctor_profile",
        applicationId,
        `Admin ${decision.toLowerCase()} a doctor application`,
        JSON.stringify({
          applicant_user_id: application.user_id,
          decision,
          rejection_reason: rejectionReason,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message:
        decision === "APPROVED"
          ? "Doctor application approved successfully"
          : "Doctor application rejected successfully",
      application_id: applicationId,
      status: decision,
    });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => undefined);
    }

    const databaseError = error as { code?: string } | null;

    if (databaseError?.code === "23503") {
      return NextResponse.json(
        {
          success: false,
          message: "Related account or reviewer not found",
        },
        { status: 409 }
      );
    }

    console.error("Admin doctor application PATCH error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to review application",
      },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
