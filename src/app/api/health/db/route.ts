import { NextResponse } from "next/server";
import pool from "@/lib/db";

// export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await pool.query("SELECT NOW() AS database_time");

    return NextResponse.json({
      success: true,
      message: "MediSphere database connected successfully",
      database: "connected",
      timestamp: result.rows[0].database_time,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Database connection failed",
        database: "disconnected",
      },
      { status: 503 },
    );
  }
}
