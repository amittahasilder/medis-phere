
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";

type Context = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const user = getAuthenticatedUser(request);

    const result = await pool.query(
      `SELECT
        b.*,
        u.full_name AS author_name
       FROM blog_posts b
       JOIN users u ON u.id = b.author_user_id
       WHERE b.slug = $1
       AND (
         b.status = 'PUBLISHED'
         OR b.author_user_id = $2
         OR $3 = 'ADMIN'
       )`,
      [slug, user?.userId || null, user?.role?.toUpperCase() || ""]
    );

    if (!result.rows.length) {
      return NextResponse.json(
        { success: false, message: "Blog not found" },
        { status: 404 }
      );
    }

    const blog = result.rows[0];

    if (blog.status === "PUBLISHED") {
      await pool.query(
        "UPDATE blog_posts SET view_count = view_count + 1 WHERE id = $1",
        [blog.id]
      );
      blog.view_count += 1;
    }

    return NextResponse.json({
      success: true,
      blog,
    });
  } catch (error) {
    console.error("Blog detail GET error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve blog" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
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

    const existing = await pool.query(
      "SELECT id, author_user_id FROM blog_posts WHERE slug = $1",
      [slug]
    );

    if (!existing.rows.length) {
      return NextResponse.json(
        { success: false, message: "Blog not found" },
        { status: 404 }
      );
    }

    const blog = existing.rows[0];
    const isAdmin = user.role.toUpperCase() === "ADMIN";
    const isOwner = blog.author_user_id === user.userId;

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, message: "You cannot edit this blog" },
        { status: 403 }
      );
    }

    const allowed: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (
        typeof body.title !== "string" ||
        !body.title.trim() ||
        body.title.trim().length > 250
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid title" },
          { status: 400 }
        );
      }
      allowed.title = body.title.trim();
    }

    if (body.content !== undefined) {
      if (
        typeof body.content !== "string" ||
        !body.content.trim() ||
        body.content.length > 100000
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid content" },
          { status: 400 }
        );
      }
      allowed.content = body.content.trim();
    }

    for (const field of [
      "excerpt",
      "featured_image_url",
      "category",
    ]) {
      if (body[field] !== undefined) {
        if (body[field] !== null && typeof body[field] !== "string") {
          return NextResponse.json(
            { success: false, message: `Invalid ${field}` },
            { status: 400 }
          );
        }
        allowed[field] =
          typeof body[field] === "string"
            ? body[field].trim()
            : null;
      }
    }

    if (body.tags !== undefined) {
      if (
        !Array.isArray(body.tags) ||
        body.tags.some((tag: unknown) => typeof tag !== "string")
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid tags" },
          { status: 400 }
        );
      }
      allowed.tags = body.tags
        .map((tag: string) => tag.trim())
        .filter(Boolean)
        .slice(0, 20);
    }

    if (body.status !== undefined) {
      const status =
        typeof body.status === "string" ? body.status.toUpperCase() : "";

      if (
        !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid blog status" },
          { status: 400 }
        );
      }

      // Only ADMIN can archive a blog.
      if (status === "ARCHIVED" && !isAdmin) {
        return NextResponse.json(
          { success: false, message: "Only admin can archive blogs" },
          { status: 403 }
        );
      }

      allowed.status = status;
    }

    const fields = Object.keys(allowed);

    if (!fields.length) {
      return NextResponse.json(
        { success: false, message: "No valid fields provided" },
        { status: 400 }
      );
    }

    const values: unknown[] = [blog.id];
    const assignments = fields.map((field, index) => {
      values.push(allowed[field]);
      return `${field} = $${index + 2}`;
    });

    if (allowed.status === "PUBLISHED") {
      assignments.push("published_at = COALESCE(published_at, NOW())");
    }

    if (allowed.status === "DRAFT" || allowed.status === "ARCHIVED") {
      assignments.push("published_at = NULL");
    }

    assignments.push("updated_at = NOW()");

    const updated = await pool.query(
      `UPDATE blog_posts
       SET ${assignments.join(", ")}
       WHERE id = $1
       RETURNING *`,
      values
    );

    return NextResponse.json({
      success: true,
      message: "Blog updated successfully",
      blog: updated.rows[0],
    });
  } catch (error) {
    console.error("Blog PATCH error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to update blog" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const user = getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 }
      );
    }

    const { slug } = await context.params;

    const existing = await pool.query(
      "SELECT id, author_user_id FROM blog_posts WHERE slug = $1",
      [slug]
    );

    if (!existing.rows.length) {
      return NextResponse.json(
        { success: false, message: "Blog not found" },
        { status: 404 }
      );
    }

    const blog = existing.rows[0];
    const isAdmin = user.role.toUpperCase() === "ADMIN";
    const isOwner = blog.author_user_id === user.userId;

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, message: "You cannot delete this blog" },
        { status: 403 }
      );
    }

    await pool.query("DELETE FROM blog_posts WHERE id = $1", [blog.id]);

    return NextResponse.json({
      success: true,
      message: "Blog deleted successfully",
    });
  } catch (error) {
    console.error("Blog DELETE error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to delete blog" },
      { status: 500 }
    );
  }
}
