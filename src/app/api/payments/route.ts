import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";

const PAYMENT_METHODS = [
  "BKASH",
  "NAGAD",
  "ROCKET",
  "CARD",
  "BANK",
  "OTHER",
];

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
      `SELECT id, subscription_id, amount, currency,
              payment_method, transaction_id, status,
              paid_at, created_at
       FROM payment_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user.userId]
    );

    return NextResponse.json({
      success: true,
      payments: result.rows,
    });
  } catch (error) {
    console.error("Payment history error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve payments" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { subscription_id, payment_method, transaction_id } = body;

    if (
      typeof subscription_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subscription_id)
    ) {
      return NextResponse.json(
        { success: false, message: "Valid subscription_id is required" },
        { status: 400 }
      );
    }

    if (
      typeof payment_method !== "string" ||
      !PAYMENT_METHODS.includes(payment_method)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid payment method" },
        { status: 400 }
      );
    }

    if (
      typeof transaction_id !== "string" ||
      transaction_id.trim().length < 3 ||
      transaction_id.trim().length > 150
    ) {
      return NextResponse.json(
        { success: false, message: "Valid transaction_id is required" },
        { status: 400 }
      );
    }

    const subscription = await pool.query(
      `SELECT us.id, sp.price, sp.currency
       FROM user_subscriptions us
       INNER JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.id = $1
         AND us.user_id = $2
         AND us.status = 'ACTIVE'
         AND (us.expires_at IS NULL OR us.expires_at > NOW())`,
      [subscription_id, user.userId]
    );

    if (subscription.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Active subscription not found" },
        { status: 404 }
      );
    }

    const plan = subscription.rows[0];

    if (Number(plan.price) <= 0) {
      return NextResponse.json(
        { success: false, message: "Free subscriptions do not require payment" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `INSERT INTO payment_transactions
       (user_id, subscription_id, amount, currency,
        payment_method, transaction_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING id, subscription_id, amount, currency,
                 payment_method, transaction_id, status, created_at`,
      [
        user.userId,
        subscription_id,
        plan.price,
        plan.currency,
        payment_method,
        transaction_id.trim(),
      ]
    );

    return NextResponse.json(
      {
        success: true,
        message: "Payment submitted for verification",
        payment: result.rows[0],
      },
      { status: 201 }
    );
  } catch (error) {
    const dbError = error as { code?: string };

    if (dbError.code === "23505") {
      return NextResponse.json(
        { success: false, message: "Transaction ID already exists" },
        { status: 409 }
      );
    }

    console.error("Payment creation error:", error);

    return NextResponse.json(
      { success: false, message: "Failed to create payment request" },
      { status: 500 }
    );
  }
}