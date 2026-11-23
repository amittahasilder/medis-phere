import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ commentId: string }>;
};

// PATCH: Admin approves or rejects a comment
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = getAuthenticatedUser(request);

    if (!user || user.role !== "ADMIN") {
      return NextResponse.json(
        { success: false, message: "Admin access required" },
        { status: 403 }
      );
    }

    const { commentId } = await context.params;
    const body = await request.json();

    if (typeof body.is_approved !== "boolean") {
      return NextResponse.json(
        { success: false, message: "is_approved must be true or false" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `UPDATE blog_comments
       SET is_approved = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, comment_text, is_approved, updated_at`,
      [body.is_approved, commentId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Comment not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: body.is_approved
        ? "Comment approved"
        : "Comment rejected",
      comment: result.rows[0],
    });
  } catch (error) {
    console.error("Admin comment PATCH error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update comment" },
      { status: 500 }
    );
  }
}

// DELETE: Admin or comment owner deletes comment
export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const user = getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 }
      );
    }

    const { commentId } = await context.params;

    const result = await pool.query(
      `DELETE FROM blog_comments
       WHERE id = $1
         AND (user_id = $2 OR $3 = 'ADMIN')
       RETURNING id`,
      [commentId, user.userId, user.role]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Comment not found or permission denied",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Comment deleted successfully",
    });
  } catch (error) {
    console.error("Blog comment DELETE error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete comment" },
      { status: 500 }
    );
  }
}