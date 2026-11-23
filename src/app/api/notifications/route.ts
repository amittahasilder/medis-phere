import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

// Verify logged-in active user
async function requireUser(): Promise<
  { userId: string } | { error: NextResponse }
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
    `SELECT id
     FROM users
     WHERE id = $1
       AND is_active = TRUE
     LIMIT 1`,
    [decoded.userId],
  );

  if (result.rows.length === 0) {
    return {
      error: NextResponse.json(
        { success: false, message: "Account not available" },
        { status: 401 },
      ),
    };
  }

  return { userId: result.rows[0].id };
}

// GET: Retrieve only the current user's notifications
export async function GET() {
  try {
    const auth = await requireUser();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT
         id,
         title,
         message,
         notification_type,
         reference_id,
         action_url,
         is_read,
         read_at,
         created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [auth.userId],
    );

    const unreadResult = await pool.query(
      `SELECT COUNT(*)::integer AS unread_count
       FROM notifications
       WHERE user_id = $1
         AND is_read = FALSE`,
      [auth.userId],
    );

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      unread_count: unreadResult.rows[0].unread_count,
      notifications: result.rows,
    });
  } catch (error) {
    console.error("Notifications GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve notifications" },
      { status: 500 },
    );
  }
}

// PATCH: Mark one notification or all notifications as read
export async function PATCH(request: Request) {
  try {
    const auth = await requireUser();

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

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid request data" },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;

    // Mark all notifications as read
    if (input.mark_all === true) {
      const result = await pool.query(
        `UPDATE notifications
         SET is_read = TRUE,
             read_at = COALESCE(read_at, NOW())
         WHERE user_id = $1
           AND is_read = FALSE`,
        [auth.userId],
      );

      return NextResponse.json({
        success: true,
        message: "All notifications marked as read",
        updated_count: result.rowCount ?? 0,
      });
    }

    // Mark one notification as read
    const notificationId = input.notification_id;

    if (
      typeof notificationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        notificationId,
      )
    ) {
      return NextResponse.json(
        { success: false, message: "Valid notification_id is required" },
        { status: 400 },
      );
    }

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE,
           read_at = COALESCE(read_at, NOW())
       WHERE id = $1
         AND user_id = $2
       RETURNING id, is_read, read_at`,
      [notificationId, auth.userId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Notification not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Notification marked as read",
      notification: result.rows[0],
    });
  } catch (error) {
    console.error("Notifications PATCH error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to update notification" },
      { status: 500 },
    );
  }
}
