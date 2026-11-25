import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT
         id,
         plan_code,
         plan_name,
         description,
         price,
         currency,
         billing_interval,
         features
       FROM subscription_plans
       WHERE is_active = TRUE
       ORDER BY price ASC`
    );

    return NextResponse.json({
      success: true,
      plans: result.rows,
    });
  } catch (error) {
    console.error("Subscription plans GET error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to retrieve subscription plans",
      },
      { status: 500 }
    );
  }
}