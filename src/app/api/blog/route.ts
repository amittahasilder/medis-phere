
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/api-auth";


export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim() || "";
    const category = searchParams.get("category")?.trim() || "";
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(
      50,
      Math.max(1, Number(searchParams.get("limit") || 10))
    );
    const offset = (page - 1) * limit;

    const values: unknown[] = [];
    const conditions = ["status = 'PUBLISHED'"];

    if (search) {
      values.push(`%${search}%`);
      conditions.push(
        `(title ILIKE $${values.length} OR excerpt ILIKE $${values.length} OR content ILIKE $${values.length})`
      );
    }

    if (category) {
      values.push(category);
      conditions.push(`category = $${values.length}`);
    }

    const where = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM blog_posts WHERE ${where}`,
      values
    );

    const dataValues = [...values, limit, offset];

    const result = await pool.query(
      `SELECT
        id,
        author_user_id,
        title,
        slug,
        excerpt,
        featured_image_url,
        category,
        tags,
        is_featured,
        published_at,
        view_count,
        created_at,
        updated_at
       FROM blog_posts
       WHERE ${where}
       ORDER BY is_featured DESC, published_at DESC NULLS LAST
       LIMIT $${dataValues.length - 1}
       OFFSET $${dataValues.length}`,
      dataValues
    );

    return NextResponse.json({
      success: true,
      blogs: result.rows,
      pagination: {
        page,
        limit,
        total: countResult.rows[0].total,
        totalPages: Math.ceil(countResult.rows[0].total / limit),
      },
    });
  } catch (error) {
    console.error("Blog GET error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to retrieve blogs" },
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

    const title =
      typeof body.title === "string" ? body.title.trim() : "";
    const content =
      typeof body.content === "string" ? body.content.trim() : "";

    if (!title || title.length > 250 || !content || content.length > 100000) {
      return NextResponse.json(
        { success: false, message: "Valid title and content are required" },
        { status: 400 }
      );
    }

    const slug =
      title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 200) +
      "-" +
      crypto.randomUUID().slice(0, 8);

    const requestedStatus =
      typeof body.status === "string" ? body.status.toUpperCase() : "DRAFT";

    const status = ["DRAFT", "PUBLISHED"].includes(requestedStatus)
      ? requestedStatus
      : "DRAFT";

    const tags = Array.isArray(body.tags)
      ? body.tags
          .filter((tag: unknown) => typeof tag === "string")
          .map((tag: string) => tag.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];

    const result = await pool.query(
      `INSERT INTO blog_posts (
        author_user_id,
        title,
        slug,
        excerpt,
        content,
        featured_image_url,
        category,
        tags,
        status,
        published_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
        CASE WHEN $9 = 'PUBLISHED' THEN NOW() ELSE NULL END
      )
      RETURNING *`,
      [
        user.userId,
        title,
        slug,
        typeof body.excerpt === "string" ? body.excerpt.trim() : null,
        content,
        typeof body.featured_image_url === "string"
          ? body.featured_image_url.trim()
          : null,
        typeof body.category === "string"
          ? body.category.trim().slice(0, 100)
          : null,
        tags,
        status,
      ]
    );

    return NextResponse.json(
      {
        success: true,
        message: "Blog created successfully",
        blog: result.rows[0],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Blog POST error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to create blog" },
      { status: 500 }
    );
  }
}
