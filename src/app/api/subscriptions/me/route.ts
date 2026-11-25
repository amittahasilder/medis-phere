import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
    const user = getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 }
      );
    }

    const result = await pool.query(
      `SELECT
         us.id,
         us.status,
         us.started_at,
         us.expires_at,
         us.auto_renew,
         sp.plan_code,
         sp.plan_name,
         sp.price,
         sp.currency,
         sp.billing_interval,
         sp.features
       FROM user_subscriptions us
       INNER JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.user_id = $1
       ORDER BY us.created_at DESC`,
      [user.userId]
    );

    return NextResponse.json({
      success: true,
      subscriptions: result.rows,
    });
  } catch (error) {
    console.error("My subscriptions GET error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to retrieve subscriptions" },
      { status: 500 }
    );
  }
}