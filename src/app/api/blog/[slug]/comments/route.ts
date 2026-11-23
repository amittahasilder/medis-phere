import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ slug: string }>;
};

// GET: Public approved comments
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { slug } = await context.params;

    const postResult = await pool.query(
      `SELECT id, status FROM blog_posts WHERE slug = $1`,
      [slug]
    );

    if (postResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Blog post not found" },
        { status: 404 }
      );
    }

    const post = postResult.rows[0];
    const user = getAuthenticatedUser(request);

    if (
      post.status !== "PUBLISHED" &&
      (!user ||
        (user.role !== "ADMIN" &&
          user.userId !== post.author_user_id))
    ) {
      return NextResponse.json(
        { success: false, message: "Blog post not found" },
        { status: 404 }
      );
    }

    const comments = await pool.query(
      `SELECT
         c.id,
         c.comment_text,
         c.parent_comment_id,
         c.created_at,
         c.user_id,
         u.full_name AS author_name
       FROM blog_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.blog_post_id = $1
         AND (
           c.is_approved = TRUE
           OR c.user_id = $2
           OR $3 = 'ADMIN'
         )
       ORDER BY c.created_at ASC`,
      [post.id, user?.userId ?? null, user?.role ?? ""]
    );

    return NextResponse.json({
      success: true,
      comments: comments.rows,
    });
  } catch (error) {
    console.error("Blog comments GET error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve comments" },
      { status: 500 }
    );
  }
}

// POST: Authenticated user creates pending comment
export async function POST(
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

    const { slug } = await context.params;
    const body = await request.json();

    const commentText =
      typeof body.comment_text === "string"
        ? body.comment_text.trim()
        : "";

    if (!commentText || commentText.length > 3000) {
      return NextResponse.json(
        {
          success: false,
          message: "Comment must be between 1 and 3000 characters",
        },
        { status: 400 }
      );
    }

    const postResult = await pool.query(
      `SELECT id FROM blog_posts
       WHERE slug = $1 AND status = 'PUBLISHED'`,
      [slug]
    );

    if (postResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Published blog not found" },
        { status: 404 }
      );
    }

    const parentId = body.parent_comment_id || null;

    if (parentId) {
      const parent = await pool.query(
        `SELECT id FROM blog_comments
         WHERE id = $1 AND blog_post_id = $2
           AND is_approved = TRUE`,
        [parentId, postResult.rows[0].id]
      );

      if (parent.rows.length === 0) {
        return NextResponse.json(
          { success: false, message: "Invalid parent comment" },
          { status: 400 }
        );
      }
    }

    const result = await pool.query(
      `INSERT INTO blog_comments
        (blog_post_id, user_id, parent_comment_id, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, comment_text, parent_comment_id,
                 is_approved, created_at`,
      [
        postResult.rows[0].id,
        user.userId,
        parentId,
        commentText,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        message: "Comment submitted for moderation",
        comment: result.rows[0],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Blog comments POST error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to submit comment" },
      { status: 500 }
    );
  }
}