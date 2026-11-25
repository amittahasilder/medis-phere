import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";

async function verifyAdmin(request: NextRequest) {
  const user = getAuthenticatedUser(request);

  if (!user) return null;

  const result = await pool.query(
    "SELECT id FROM users WHERE id = $1 AND role = 'ADMIN'",
    [user.userId]
  );

  return result.rows.length > 0 ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await verifyAdmin(request);

    if (!admin) {
      return NextResponse.json(
        { success: false, message: "Admin access required" },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `SELECT
         p.id,
         p.user_id,
         u.email,
         p.subscription_id,
         p.amount,
         p.currency,
         p.payment_method,
         p.transaction_id,
         p.status,
         p.paid_at,
         p.created_at
       FROM payment_transactions p
       INNER JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC
       LIMIT 100`
    );

    return NextResponse.json({
      success: true,
      payments: result.rows,
    });
  } catch (error) {
    console.error("Admin payment GET error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to retrieve payments" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await verifyAdmin(request);

  if (!admin) {
    return NextResponse.json(
      { success: false, message: "Admin access required" },
      { status: 403 }
    );
  }

  let client;

  try {
    const body = await request.json();
    const { payment_id, status } = body;

    if (
      typeof payment_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payment_id)
    ) {
      return NextResponse.json(
        { success: false, message: "Valid payment_id is required" },
        { status: 400 }
      );
    }

    if (!["SUCCESS", "FAILED", "REFUNDED"].includes(status)) {
      return NextResponse.json(
        { success: false, message: "Invalid payment status" },
        { status: 400 }
      );
    }

    client = await pool.connect();
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE payment_transactions
       SET status = $1,
           paid_at = CASE
             WHEN $1 = 'SUCCESS' THEN NOW()
             ELSE paid_at
           END,
           updated_at = NOW()
       WHERE id = $2
         AND (
           (status = 'PENDING' AND $1 IN ('SUCCESS', 'FAILED'))
           OR (status = 'SUCCESS' AND $1 = 'REFUNDED')
         )
       RETURNING id, user_id, subscription_id,
                 amount, currency, payment_method,
                 transaction_id, status, paid_at`,
      [status, payment_id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return NextResponse.json(
        {
          success: false,
          message: "Payment not found or invalid status transition",
        },
        { status: 409 }
      );
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: `Payment marked as ${status}`,
      payment: result.rows[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");

    console.error("Admin payment PATCH error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to update payment" },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}