
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

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

  let decoded: unknown;

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
    !decoded ||
    typeof decoded !== "object" ||
    !("userId" in decoded) ||
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

// GET: Admin dashboard statistics
export async function GET() {
  try {
    const auth = await requireAdmin();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users)
          AS total_users,

        (SELECT COUNT(*)
         FROM users
         WHERE is_active = TRUE)
          AS active_users,

        (SELECT COUNT(*)
         FROM users
         WHERE is_active = FALSE)
          AS inactive_users,

        (SELECT COUNT(*)
         FROM users
         WHERE role = 'PATIENT')
          AS total_patients,

        (SELECT COUNT(*)
         FROM doctor_profiles
         WHERE application_status = 'APPROVED')
          AS approved_doctors,

        (SELECT COUNT(*)
         FROM doctor_profiles
         WHERE application_status = 'PENDING')
          AS pending_doctor_applications,

        (SELECT COUNT(*)
         FROM doctor_profiles
         WHERE application_status = 'REJECTED')
          AS rejected_doctor_applications,

        (SELECT COUNT(*)
         FROM appointments)
          AS total_appointments,

        (SELECT COUNT(*)
         FROM appointments
         WHERE status = 'PENDING')
          AS pending_appointments,

        (SELECT COUNT(*)
         FROM appointments
         WHERE status = 'CONFIRMED')
          AS confirmed_appointments,

        (SELECT COUNT(*)
         FROM appointments
         WHERE status = 'COMPLETED')
          AS completed_appointments,

        (SELECT COUNT(*)
         FROM appointments
         WHERE status = 'CANCELLED')
          AS cancelled_appointments,

        (SELECT COUNT(*)
         FROM appointments
         WHERE status = 'REJECTED')
          AS rejected_appointments,

        (SELECT COUNT(*)
         FROM blog_posts)
          AS total_blog_posts,

        (SELECT COUNT(*)
         FROM blog_posts
         WHERE status = 'PUBLISHED')
          AS published_blog_posts,

        (SELECT COUNT(*)
         FROM blog_comments
         WHERE is_approved = FALSE)
          AS pending_blog_comments,

        (SELECT COUNT(*)
         FROM user_subscriptions
         WHERE status = 'ACTIVE')
          AS active_subscriptions,

        (SELECT COUNT(*)
         FROM payment_transactions
         WHERE status = 'SUCCESS')
          AS successful_payments,

        (SELECT COALESCE(SUM(amount), 0)
         FROM payment_transactions
         WHERE status = 'SUCCESS')
          AS total_revenue
    `);

    const row = result.rows[0];

    const stats = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        Number(value),
      ])
    );

    return NextResponse.json({
      success: true,
      message: "Admin dashboard statistics retrieved successfully",
      stats,
    });
  } catch (error) {
    console.error("Admin dashboard GET error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to retrieve dashboard statistics",
      },
      { status: 500 }
    );
  }
}
