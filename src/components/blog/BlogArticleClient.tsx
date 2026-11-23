

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  Eye,
  HeartPulse,
  Link2,
  MessageCircle,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Tag,
  UserRound,
} from "lucide-react";

type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: string | null;
  featured_image_url?: string | null;
  category?: string | null;
  tags?: string[];
  author_name?: string | null;
  author?: {
    full_name?: string;
    name?: string;
    avatar_url?: string | null;
  } | null;
  published_at?: string | null;
  created_at?: string | null;
  view_count?: number;
  status?: string;
};

type BlogComment = {
  id: string;
  user_id?: string;
  author_name?: string;
  full_name?: string;
  name?: string;
  comment_text: string;
  parent_comment_id?: string | null;
  created_at?: string;
  replies?: BlogComment[];
};

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

function readingTime(content = "") {
  const words = content.replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

function formatDate(value?: string | null) {
  if (!value) return "Recently published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently published";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function getAuthor(post: BlogPost) {
  return (
    post.author_name ||
    post.author?.full_name ||
    post.author?.name ||
    "MediSphere Editorial Team"
  );
}

/* Allow only safe article HTML elements and attributes. */
function cleanArticleHtml(html: string) {
  if (typeof window === "undefined" || !html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowedTags = new Set([
    "P", "H1", "H2", "H3", "H4", "STRONG", "B", "EM", "I",
    "U", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG", "BR",
    "HR", "CODE", "PRE",
  ]);

  const cleanNode = (node: Element) => {
    Array.from(node.children).forEach((child) => {
      if (!allowedTags.has(child.tagName)) {
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED"].includes(child.tagName)) {
          child.remove();
        } else {
          child.replaceWith(...Array.from(child.childNodes));
        }
        return;
      }

      Array.from(child.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();

        if (child.tagName === "A" && name === "href") {
          if (!/^(https?:|mailto:|\/|#)/i.test(value)) child.removeAttribute("href");
          return;
        }

        if (child.tagName === "IMG" && name === "src") {
          if (!/^https:\/\//i.test(value)) child.removeAttribute("src");
          return;
        }

        if (
          (child.tagName === "IMG" && ["alt", "title"].includes(name)) ||
          (child.tagName === "A" && name === "title")
        ) return;

        child.removeAttribute(attribute.name);
      });

      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }

      cleanNode(child);
    });
  };

  cleanNode(doc.body);
  return doc.body.innerHTML;
}

function makeCommentTree(comments: BlogComment[]) {
  const byId = new Map<string, BlogComment>();
  const roots: BlogComment[] = [];

  comments.forEach((comment) => {
    byId.set(comment.id, { ...comment, replies: [] });
  });

  byId.forEach((comment) => {
    if (comment.parent_comment_id && byId.has(comment.parent_comment_id)) {
      byId.get(comment.parent_comment_id)!.replies!.push(comment);
    } else {
      roots.push(comment);
    }
  });

  return roots;
}

export default function BlogArticleClient({ slug }: { slug: string }) {
  const reduceMotion = useReducedMotion();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [related, setRelated] = useState<BlogPost[]>([]);
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [safeContent, setSafeContent] = useState("");
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [commentMessage, setCommentMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const reduced = Boolean(reduceMotion);

  const loadComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/blog/${encodeURIComponent(slug)}/comments`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (response.ok) {
        setComments(result.comments ?? result.data ?? []);
      }
    } catch {
      // Comments are optional; the article remains readable.
    }
  }, [slug]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadArticle() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/blog/${encodeURIComponent(slug)}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "This article could not be found.");
        }

        const article = result.post ?? result.blog ?? result.data ?? result;
        if (!article?.title) throw new Error("Article data is unavailable.");

        setPost(article);

        const relatedResponse = await fetch("/api/blog?limit=20&page=1", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (relatedResponse.ok) {
          const relatedResult = await relatedResponse.json();
          const posts = relatedResult.posts ?? relatedResult.blogs ?? relatedResult.data ?? [];
          setRelated(
            posts
              .filter((item: BlogPost) => item.slug !== slug)
              .slice(0, 3)
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadArticle();
    loadComments();

    return () => controller.abort();
  }, [slug, loadComments]);

  useEffect(() => {
    if (!post?.content) return;

    const cleaned = cleanArticleHtml(post.content);
    setSafeContent(cleaned);

    const doc = new DOMParser().parseFromString(cleaned, "text/html");
    const headings = Array.from(doc.querySelectorAll("h1, h2, h3"));
    const usedIds = new Set<string>();

    setToc(
      headings.map((heading, index) => {
        const text = heading.textContent?.trim() || `Section ${index + 1}`;
        let id =
          heading.id ||
          text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
          `section-${index + 1}`;

        while (usedIds.has(id)) id = `${id}-${index + 1}`;
        usedIds.add(id);

        return {
          id,
          text,
          level: Number(heading.tagName.substring(1)),
        };
      })
    );
  }, [post]);

  useEffect(() => {
    const updateProgress = () => {
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const current = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
      setProgress(Math.min(100, Math.max(0, current)));
    };

    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);

    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, []);

  const commentTree = useMemo(() => makeCommentTree(comments), [comments]);

  async function submitComment(parentId?: string) {
    const text = (parentId ? replyText : commentText).trim();
    if (!text) {
      setCommentMessage("Please write a comment first.");
      return;
    }

    setSending(true);
    setCommentMessage("");

    try {
      const response = await fetch(`/api/blog/${encodeURIComponent(slug)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment_text: text,
          ...(parentId ? { parent_comment_id: parentId } : {}),
        }),
      });

      const result = await response.json();

      if (response.status === 401) {
        setCommentMessage("Please log in to comment on this article.");
        return;
      }

      if (!response.ok) {
        throw new Error(result.message || "Could not submit your comment.");
      }

      setCommentText("");
      setReplyText("");
      setReplyTo(null);
      setCommentMessage(
        result.message || "Your comment was submitted for moderation."
      );
      await loadComments();
    } catch (err) {
      setCommentMessage(
        err instanceof Error ? err.message : "Comment submission failed."
      );
    } finally {
      setSending(false);
    }
  }

  async function shareArticle() {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: post?.title, url });
        return;
      } catch {
        // Fall back to copying the link.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCommentMessage("Could not copy the article link.");
    }
  }

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }

  if (loading) {
    return (
      <main className="article-shell min-h-screen">
        <div className="article-loading">
          <div className="loading-orb"><HeartPulse size={30} /></div>
          <p>Preparing your reading experience...</p>
        </div>
        <ArticleStyles />
      </main>
    );
  }

  if (error || !post) {
    return (
      <main className="article-shell min-h-screen px-6">
        <div className="article-error">
          <div className="error-icon"><BookOpen size={30} /></div>
          <h1>Article unavailable</h1>
          <p>{error || "We could not find this article."}</p>
          <Link href="/blog" className="article-primary-button">
            <ArrowLeft size={17} /> Back to Blog
          </Link>
        </div>
        <ArticleStyles />
      </main>
    );
  }

  const author = getAuthor(post);
  const date = post.published_at || post.created_at;
  const minutes = readingTime(post.content || post.excerpt || "");

  return (
    <main className="article-shell min-h-screen">
      <div className="article-progress-track">
        <motion.div
          className="article-progress-fill"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.12 }}
        />
      </div>

      <header className="article-nav">
        <Link href="/blog" className="article-brand">
          <span className="brand-mark"><HeartPulse size={21} /></span>
          <span>MediSphere<span className="brand-dot">.</span></span>
        </Link>

        <div className="article-nav-actions">
          <Link href="/blog" className="nav-back-link">
            <ArrowLeft size={16} /> All Articles
          </Link>
          <button className="share-button" onClick={shareArticle} type="button">
            {copied ? <Check size={17} /> : <Share2 size={17} />}
            <span>{copied ? "Copied" : "Share"}</span>
          </button>
        </div>
      </header>

      <section className="article-hero">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />

        <motion.div
          className="article-hero-inner"
          initial={reduced ? false : "hidden"}
          animate="visible"
          variants={fadeUp}
          transition={{ duration: 0.65 }}
        >
          <div className="article-breadcrumb">
            <Link href="/">Home</Link>
            <span>/</span>
            <Link href="/blog">Blog</Link>
            <span>/</span>
            <span>{post.category || "Health"}</span>
          </div>

          <div className="article-category">
            <Sparkles size={14} />
            {post.category || "Health & Wellness"}
          </div>

          <h1>{post.title}</h1>
          {post.excerpt && <p className="article-subtitle">{post.excerpt}</p>}

          <div className="article-meta">
            <div className="author-avatar"><UserRound size={20} /></div>
            <div className="author-details">
              <strong>{author}</strong>
              <span>Editorial contributor</span>
            </div>
            <span className="meta-divider" />
            <span className="meta-item"><CalendarDays size={15} />{formatDate(date)}</span>
            <span className="meta-item"><Clock3 size={15} />{minutes} min read</span>
            <span className="meta-item"><Eye size={15} />{post.view_count ?? 0} views</span>
          </div>
        </motion.div>
      </section>

      {post.featured_image_url && (
        <motion.div
          className="article-cover-wrap"
          initial={reduced ? false : { opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          <img
            src={post.featured_image_url}
            alt={post.title}
            className="article-cover"
          />
          <div className="cover-shine" />
        </motion.div>
      )}

      <div className="article-layout">
        <aside className="article-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-heading"><BookOpen size={17} /> On this page</div>
            {toc.length > 0 ? (
              <nav className="toc-list">
                {toc.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`toc-link toc-level-${item.level}`}
                    onClick={() => scrollToSection(item.id)}
                  >
                    {item.text}
                  </button>
                ))}
              </nav>
            ) : (
              <p className="toc-empty">Article sections will appear here.</p>
            )}
          </div>

          <div className="sidebar-tip">
            <ShieldCheck size={20} />
            <strong>Health information</strong>
            <p>Use this article for general education, not as a substitute for professional medical advice.</p>
          </div>
        </aside>

        <article className="article-content-column">
          <div className="article-content-card">
            <div className="article-content" id="article-body">
              {safeContent ? (
                <div
                  className="rich-article-content"
                  dangerouslySetInnerHTML={{ __html: safeContent }}
                  ref={(element) => {
                    if (!element || toc.length === 0) return;
                    const headings = element.querySelectorAll("h1, h2, h3");
                    headings.forEach((heading, index) => {
                      const item = toc[index];
                      if (item) heading.id = item.id;
                    });
                  }}
                />
              ) : (
                <div className="plain-article-content">
                  {(post.content || post.excerpt || "No article content is available.")
                    .split(/\n{2,}/)
                    .map((paragraph, index) => (
                      <p key={index}>{paragraph.replace(/<[^>]*>/g, "")}</p>
                    ))}
                </div>
              )}
            </div>

            {Array.isArray(post.tags) && post.tags.length > 0 && (
              <div className="article-tags">
                <Tag size={16} />
                {post.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}

            <div className="article-end-note">
              <HeartPulse size={19} />
              <p>Thank you for reading MediSphere. Your health journey starts with knowledge.</p>
            </div>

            <div className="article-share-row">
              <span>Found this helpful?</span>
              <button type="button" onClick={shareArticle}>
                <Share2 size={16} /> Share article
              </button>
            </div>
          </div>

          <section className="comments-section" id="comments">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">COMMUNITY DISCUSSION</span>
                <h2>Reader comments <span>({comments.length})</span></h2>
              </div>
              <MessageCircle size={25} />
            </div>

            <div className="comment-composer">
              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Share your thoughts or ask a question..."
                rows={4}
                maxLength={2000}
              />
              <div className="composer-footer">
                <span>Be kind and keep the discussion helpful.</span>
                <button
                  type="button"
                  className="article-primary-button"
                  onClick={() => submitComment()}
                  disabled={sending}
                >
                  <Send size={15} /> {sending ? "Sending..." : "Post comment"}
                </button>
              </div>
              {commentMessage && <p className="comment-feedback">{commentMessage}</p>}
            </div>

            <div className="comments-list">
              {commentTree.length === 0 ? (
                <div className="no-comments">
                  <MessageCircle size={27} />
                  <strong>Start the conversation</strong>
                  <p>There are no approved comments yet. Be the first to share your thoughts.</p>
                </div>
              ) : (
                commentTree.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    replyTo={replyTo}
                    replyText={replyText}
                    sending={sending}
                    setReplyTo={setReplyTo}
                    setReplyText={setReplyText}
                    submitComment={submitComment}
                  />
                ))
              )}
            </div>
          </section>
        </article>
      </div>

      {related.length > 0 && (
        <section className="related-section">
          <div className="related-heading">
            <div>
              <span className="section-eyebrow">KEEP EXPLORING</span>
              <h2>Related articles</h2>
            </div>
            <Link href="/blog">Explore all <ArrowUpRight size={16} /></Link>
          </div>

          <div className="related-grid">
            {related.map((item, index) => (
              <motion.div
                key={item.id || item.slug}
                initial={reduced ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
              >
                <Link href={`/blog/${item.slug}`} className="related-card">
                  {item.featured_image_url ? (
                    <img src={item.featured_image_url} alt={item.title} />
                  ) : (
                    <div className="related-placeholder"><HeartPulse size={30} /></div>
                  )}
                  <div className="related-card-body">
                    <span>{item.category || "Health & Wellness"}</span>
                    <h3>{item.title}</h3>
                    <div className="related-card-footer">
                      <small><Clock3 size={13} /> {readingTime(item.content || item.excerpt || "")} min read</small>
                      <ArrowRight size={17} />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <footer className="article-footer">
        <Link href="/blog" className="article-brand">
          <span className="brand-mark"><HeartPulse size={20} /></span>
          <span>MediSphere<span className="brand-dot">.</span></span>
        </Link>
        <p>Healthcare knowledge for everyone.</p>
        <span>© 2026 MediSphere</span>
      </footer>

      <ArticleStyles />
    </main>
  );
}

function CommentItem({
  comment,
  replyTo,
  replyText,
  sending,
  setReplyTo,
  setReplyText,
  submitComment,
}: {
  comment: BlogComment;
  replyTo: string | null;
  replyText: string;
  sending: boolean;
  setReplyTo: (id: string | null) => void;
  setReplyText: (text: string) => void;
  submitComment: (parentId?: string) => void;
}) {
  const author = comment.author_name || comment.full_name || comment.name || "MediSphere Reader";

  return (
    <div className="comment-item">
      <div className="comment-avatar"><UserRound size={17} /></div>
      <div className="comment-main">
        <div className="comment-author-row">
          <strong>{author}</strong>
          <span>{formatDate(comment.created_at)}</span>
        </div>
        <p>{comment.comment_text}</p>
        <button
          className="reply-button"
          type="button"
          onClick={() => {
            setReplyTo(replyTo === comment.id ? null : comment.id);
            setReplyText("");
          }}
        >
          <MessageCircle size={14} /> Reply
        </button>

        {replyTo === comment.id && (
          <div className="reply-composer">
            <textarea
              rows={2}
              value={replyText}
              onChange={(event) => setReplyText(event.target.value)}
              placeholder="Write a reply..."
              maxLength={2000}
            />
            <button
              type="button"
              className="article-primary-button"
              onClick={() => submitComment(comment.id)}
              disabled={sending}
            >
              <Send size={14} /> {sending ? "Sending..." : "Send reply"}
            </button>
          </div>
        )}

        {comment.replies && comment.replies.length > 0 && (
          <div className="comment-replies">
            {comment.replies.map((reply) => (
              <div className="reply-item" key={reply.id}>
                <div className="comment-avatar reply-avatar"><UserRound size={15} /></div>
                <div>
                  <div className="comment-author-row">
                    <strong>{reply.author_name || reply.full_name || reply.name || "Reader"}</strong>
                    <span>{formatDate(reply.created_at)}</span>
                  </div>
                  <p>{reply.comment_text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ArticleStyles() {
  return (
    <style jsx global>{`
      .article-shell {
        --article-ink: #102c3a;
        --article-muted: #6c818c;
        --article-teal: #0e9f91;
        --article-border: rgba(16, 90, 100, .12);
        color: var(--article-ink);
        background:
          radial-gradient(ellipse at 10% 5%, rgba(13, 168, 153, .09), transparent 34%),
          radial-gradient(ellipse at 90% 28%, rgba(82, 155, 199, .08), transparent 30%),
          #f6fafb;
        overflow: hidden;
      }
      .article-progress-track {
        position: fixed; inset: 0 0 auto; height: 3px; z-index: 100;
        background: rgba(15, 60, 70, .08);
      }
      .article-progress-fill {
        height: 100%; background: linear-gradient(90deg, #0e9f91, #53c9b7, #4b9ed4);
      }
      .article-nav {
        max-width: 1220px; margin: auto; padding: 22px 28px;
        display: flex; justify-content: space-between; align-items: center;
        position: relative; z-index: 2;
      }
      .article-brand {
        display: inline-flex; align-items: center; gap: 10px;
        font-size: 20px; font-weight: 850; letter-spacing: -.7px; color: #123342;
      }
      .brand-mark {
        display: grid; place-items: center; width: 38px; height: 38px;
        border-radius: 13px; color: white;
        background: linear-gradient(135deg, #0e9f91, #176b89);
        box-shadow: 0 8px 22px rgba(14, 159, 145, .24);
      }
      .brand-dot { color: #0e9f91; }
      .article-nav-actions { display: flex; align-items: center; gap: 18px; }
      .nav-back-link, .share-button {
        display: inline-flex; align-items: center; gap: 8px;
        color: #49636f; font-size: 13px; font-weight: 700;
      }
      .share-button {
        border: 1px solid var(--article-border); border-radius: 12px;
        padding: 10px 15px; background: rgba(255,255,255,.72);
        cursor: pointer; transition: .2s;
      }
      .share-button:hover { color: #078f83; border-color: #0e9f91; transform: translateY(-2px); }
      .article-hero {
        position: relative; padding: 64px 24px 85px;
        background: linear-gradient(135deg, #eaf7f5 0%, #f4f9fc 55%, #edf5fa 100%);
        border-top: 1px solid rgba(255,255,255,.9);
        border-bottom: 1px solid var(--article-border);
      }
      .article-hero-inner { max-width: 920px; margin: auto; position: relative; z-index: 1; }
      .hero-glow {
        position: absolute; width: 330px; height: 330px; border-radius: 50%;
        filter: blur(75px); opacity: .24; pointer-events: none;
      }
      .hero-glow-one { background: #64d8c4; top: -120px; left: -100px; }
      .hero-glow-two { background: #8ab9e8; bottom: -150px; right: -90px; }
      .article-breadcrumb {
        display: flex; flex-wrap: wrap; gap: 10px; color: #82949c;
        font-size: 12px; margin-bottom: 27px;
      }
      .article-breadcrumb a:hover { color: #0e9f91; }
      .article-category {
        display: inline-flex; align-items: center; gap: 7px;
        padding: 8px 13px; border: 1px solid rgba(14,159,145,.2);
        background: rgba(255,255,255,.58); color: #078f83;
        border-radius: 30px; font-size: 11px; font-weight: 800;
        letter-spacing: .5px; text-transform: uppercase; backdrop-filter: blur(12px);
      }
      .article-hero h1 {
        max-width: 900px; margin: 22px 0 15px;
        font-size: clamp(36px, 5.3vw, 62px); line-height: 1.09;
        letter-spacing: -2.8px; font-weight: 850; color: #102e3b;
      }
      .article-subtitle {
        max-width: 760px; color: #647c87; font-size: 17px; line-height: 1.8;
      }
      .article-meta {
        display: flex; align-items: center; flex-wrap: wrap; gap: 14px;
        margin-top: 30px; color: #70838c; font-size: 12px;
      }
      .author-avatar, .comment-avatar {
        display: grid; place-items: center; flex: 0 0 auto;
        width: 39px; height: 39px; border-radius: 50%;
        color: #087f76; background: linear-gradient(135deg, #d8f4ee, #e0edf8);
      }
      .author-details { display: grid; gap: 3px; }
      .author-details strong { color: #24424e; font-size: 12px; }
      .author-details span { font-size: 10px; color: #91a0a7; }
      .meta-divider { width: 1px; height: 28px; background: #d5e2e5; }
      .meta-item { display: inline-flex; align-items: center; gap: 6px; }
      .article-cover-wrap {
        max-width: 1120px; height: clamp(230px, 48vw, 520px);
        margin: -36px auto 0; position: relative; z-index: 3;
        border: 7px solid rgba(255,255,255,.85); border-radius: 25px;
        overflow: hidden; box-shadow: 0 25px 75px rgba(21,67,79,.14);
      }
      .article-cover { width: 100%; height: 100%; object-fit: cover; display: block; }
      .cover-shine {
        position: absolute; inset: 0; pointer-events: none;
        background: linear-gradient(120deg, rgba(255,255,255,.18), transparent 35%, transparent);
      }
      .article-layout {
        max-width: 1180px; margin: 65px auto 0; padding: 0 24px;
        display: grid; grid-template-columns: 245px minmax(0, 1fr); gap: 34px;
        align-items: start;
      }
      .article-sidebar { position: sticky; top: 25px; display: grid; gap: 17px; }
      .sidebar-card, .sidebar-tip, .article-content-card, .comments-section {
        border: 1px solid rgba(20,90,100,.1); border-radius: 20px;
        background: rgba(255,255,255,.78); backdrop-filter: blur(18px);
        box-shadow: 0 12px 40px rgba(25,73,83,.045);
      }
      .sidebar-card { padding: 21px 18px; }
      .sidebar-heading { display: flex; gap: 9px; align-items: center; font-size: 13px; font-weight: 800; margin-bottom: 16px; }
      .sidebar-heading svg { color: #0e9f91; }
      .toc-list { display: grid; gap: 5px; }
      .toc-link {
        text-align: left; padding: 8px 9px; border: 0; border-radius: 8px;
        background: transparent; color: #70838c; font-size: 11px;
        line-height: 1.5; cursor: pointer; transition: .2s;
      }
      .toc-link:hover { color: #087f76; background: #edf8f6; }
      .toc-level-1 { font-weight: 800; color: #405b65; }
      .toc-level-3 { padding-left: 19px; }
      .toc-empty { color: #8b9ba2; font-size: 11px; line-height: 1.6; }
      .sidebar-tip { padding: 19px; display: grid; gap: 9px; color: #71858e; }
      .sidebar-tip svg { color: #0e9f91; }
      .sidebar-tip strong { color: #35515c; font-size: 12px; }
      .sidebar-tip p { font-size: 11px; line-height: 1.7; }
      .article-content-card { padding: clamp(23px, 4vw, 48px); }
      .rich-article-content, .plain-article-content {
        color: #435c67; font-size: 16px; line-height: 1.95;
        overflow-wrap: anywhere;
      }
      .rich-article-content p, .plain-article-content p { margin: 0 0 22px; }
      .rich-article-content h1, .rich-article-content h2, .rich-article-content h3 {
        color: #153743; font-weight: 850; letter-spacing: -.7px;
        line-height: 1.3; scroll-margin-top: 30px;
      }
      .rich-article-content h1 { font-size: 30px; margin: 40px 0 18px; }
      .rich-article-content h2 { font-size: 25px; margin: 36px 0 15px; }
      .rich-article-content h3 { font-size: 20px; margin: 28px 0 12px; }
      .rich-article-content ul, .rich-article-content ol { padding-left: 25px; margin: 0 0 23px; }
      .rich-article-content li { padding: 4px 0 4px 5px; }
      .rich-article-content blockquote {
        margin: 28px 0; padding: 18px 22px; border-left: 4px solid #0e9f91;
        background: #eff9f7; border-radius: 0 13px 13px 0; color: #42656b;
      }
      .rich-article-content a { color: #078f83; text-decoration: underline; }
      .rich-article-content img {
        display: block; max-width: 100%; height: auto; margin: 28px auto;
        border-radius: 15px; box-shadow: 0 12px 35px rgba(15,55,65,.1);
      }
      .rich-article-content pre {
        overflow-x: auto; padding: 18px; border-radius: 12px;
        background: #102c3a; color: #e4f4f3; font-size: 13px;
      }
      .rich-article-content code {
        background: #edf5f5; padding: 2px 5px; border-radius: 5px;
      }
      .article-tags {
        display: flex; flex-wrap: wrap; align-items: center; gap: 9px;
        border-top: 1px solid #eaf0f1; padding-top: 24px; margin-top: 28px;
        color: #0e9f91;
      }
      .article-tags span {
        border: 1px solid #dcecea; background: #f3faf8; color: #52736f;
        border-radius: 30px; padding: 6px 11px; font-size: 10px; font-weight: 700;
      }
      .article-end-note {
        display: flex; gap: 12px; align-items: center; margin-top: 30px;
        padding: 17px; border-radius: 13px; background: #eef8f6; color: #54736f;
      }
      .article-end-note svg { flex: 0 0 auto; color: #0e9f91; }
      .article-end-note p { font-size: 12px; line-height: 1.6; }
      .article-share-row {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding-top: 23px; margin-top: 23px;
        border-top: 1px solid #eaf0f1; color: #71858e; font-size: 12px;
      }
      .article-share-row button, .related-heading a {
        display: inline-flex; align-items: center; gap: 7px;
        border: 0; background: transparent; color: #078f83;
        font-weight: 800; cursor: pointer;
      }
      .comments-section { padding: clamp(22px, 3.5vw, 38px); margin-top: 28px; }
      .section-heading, .related-heading {
        display: flex; align-items: center; justify-content: space-between; gap: 15px;
      }
      .section-heading > svg { color: #0e9f91; }
      .section-eyebrow { color: #0e9f91; font-size: 9px; font-weight: 900; letter-spacing: 1.5px; }
      .section-heading h2, .related-heading h2 {
        margin-top: 7px; font-size: 25px; font-weight: 850; letter-spacing: -.8px; color: #173944;
      }
      .section-heading h2 span { color: #8a9ba1; font-size: 15px; }
      .comment-composer {
        margin-top: 24px; padding: 15px; border: 1px solid #e4eeee;
        border-radius: 14px; background: #fbfdfd;
      }
      .comment-composer textarea, .reply-composer textarea {
        width: 100%; resize: vertical; border: 0; outline: none;
        background: transparent; color: #294752; font-size: 13px; line-height: 1.7;
      }
      .comment-composer textarea::placeholder, .reply-composer textarea::placeholder { color: #9aabb0; }
      .composer-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 10px; }
      .composer-footer > span { color: #98a8ad; font-size: 10px; }
      .article-primary-button {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        padding: 11px 16px; border: 0; border-radius: 10px;
        color: white; font-size: 11px; font-weight: 800; cursor: pointer;
        background: linear-gradient(135deg, #0e9f91, #167b91);
        box-shadow: 0 7px 17px rgba(14,159,145,.18); transition: .2s;
      }
      .article-primary-button:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(14,159,145,.25); }
      .article-primary-button:disabled { opacity: .55; cursor: not-allowed; transform: none; }
      .comment-feedback { margin-top: 10px; color: #0b8d80; font-size: 11px; line-height: 1.5; }
      .comments-list { display: grid; gap: 22px; margin-top: 28px; }
      .comment-item { display: flex; align-items: flex-start; gap: 12px; }
      .comment-avatar { width: 34px; height: 34px; }
      .comment-main { flex: 1; min-width: 0; }
      .comment-author-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
      .comment-author-row strong { color: #2c4a55; font-size: 12px; }
      .comment-author-row span { color: #9aabb0; font-size: 10px; }
      .comment-main > p, .reply-item p {
        margin-top: 8px; color: #647982; font-size: 12px; line-height: 1.75;
        white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .reply-button {
        display: inline-flex; align-items: center; gap: 5px; margin-top: 9px;
        border: 0; background: transparent; color: #0b9488;
        font-size: 10px; font-weight: 800; cursor: pointer;
      }
      .reply-composer {
        margin-top: 12px; padding: 12px; border: 1px solid #e2eeee;
        border-radius: 12px; background: #f9fcfc;
      }
      .reply-composer .article-primary-button { margin-top: 8px; }
      .comment-replies {
        display: grid; gap: 16px; margin: 17px 0 0 3px;
        padding-left: 17px; border-left: 2px solid #e3f1ef;
      }
      .reply-item { display: flex; gap: 10px; }
      .reply-avatar { width: 28px; height: 28px; }
      .no-comments {
        display: grid; justify-items: center; text-align: center; gap: 8px;
        padding: 28px 15px; color: #91a3a9;
      }
      .no-comments svg { color: #0e9f91; }
      .no-comments strong { color: #46616b; font-size: 13px; }
      .no-comments p { max-width: 300px; font-size: 11px; line-height: 1.6; }
      .related-section { max-width: 1180px; margin: 85px auto 0; padding: 0 24px 75px; }
      .related-heading { margin-bottom: 24px; }
      .related-heading a { font-size: 12px; }
      .related-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
      .related-card {
        display: block; height: 100%; overflow: hidden; border-radius: 17px;
        border: 1px solid rgba(20,90,100,.1); background: rgba(255,255,255,.85);
        box-shadow: 0 10px 30px rgba(25,73,83,.045); transition: .25s;
      }
      .related-card:hover { transform: translateY(-6px); box-shadow: 0 18px 38px rgba(25,73,83,.11); }
      .related-card > img, .related-placeholder { width: 100%; height: 165px; object-fit: cover; }
      .related-placeholder { display: grid; place-items: center; color: #0e9f91; background: linear-gradient(135deg, #dff5ef, #e8f1fa); }
      .related-card-body { padding: 18px; }
      .related-card-body > span { color: #0e9f91; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .8px; }
      .related-card-body h3 { margin-top: 9px; color: #25434e; font-size: 16px; line-height: 1.45; font-weight: 800; }
      .related-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 19px; color: #0e9f91; }
      .related-card-footer small { display: flex; align-items: center; gap: 5px; color: #8b9da3; font-size: 10px; }
      .article-footer {
        display: flex; justify-content: space-between; align-items: center; gap: 15px;
        padding: 25px max(24px, calc((100% - 1130px) / 2));
        border-top: 1px solid #e5eeee; background: rgba(255,255,255,.7);
      }
      .article-footer .article-brand { font-size: 16px; }
      .article-footer .brand-mark { width: 32px; height: 32px; border-radius: 10px; }
      .article-footer p, .article-footer > span { color: #8b9da3; font-size: 10px; }
      .article-loading, .article-error {
        min-height: 75vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; text-align: center; padding: 25px;
      }
      .article-loading p { margin-top: 18px; color: #6d858e; font-size: 13px; }
      .loading-orb, .error-icon {
        display: grid; place-items: center; width: 70px; height: 70px;
        border-radius: 23px; color: #0e9f91;
        background: linear-gradient(135deg, #dff7f0, #e7f1fa);
        box-shadow: 0 12px 35px rgba(14,159,145,.15);
      }
      .loading-orb { animation: articleFloat 2s ease-in-out infinite; }
      .article-error h1 { margin-top: 20px; color: #173944; font-size: 27px; font-weight: 850; }
      .article-error p { margin: 10px 0 20px; color: #71858e; font-size: 13px; }
      @keyframes articleFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
      @media (max-width: 850px) {
        .article-layout { grid-template-columns: 1fr; }
        .article-sidebar { position: static; }
        .sidebar-tip { display: none; }
        .toc-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .related-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .article-cover-wrap { margin-left: 20px; margin-right: 20px; }
      }
      @media (max-width: 560px) {
        .article-nav { padding: 16px 18px; }
        .article-brand { font-size: 17px; }
        .article-nav-actions { gap: 11px; }
        .nav-back-link { font-size: 0; gap: 0; }
        .nav-back-link svg { width: 19px; height: 19px; }
        .share-button { padding: 9px 11px; }
        .article-hero { padding: 42px 20px 65px; }
        .article-hero h1 { letter-spacing: -1.6px; }
        .article-subtitle { font-size: 14px; }
        .article-meta { gap: 11px; }
        .meta-divider { display: none; }
        .article-cover-wrap { height: 235px; margin-top: -25px; border-width: 4px; border-radius: 17px; }
        .article-layout { margin-top: 35px; padding: 0 15px; gap: 18px; }
        .toc-list { grid-template-columns: 1fr; }
        .article-content-card { padding: 22px 18px; }
        .rich-article-content, .plain-article-content { font-size: 14px; }
        .comments-section { padding: 21px 17px; }
        .composer-footer { align-items: flex-start; flex-direction: column; }
        .related-section { margin-top: 55px; padding: 0 15px 50px; }
        .related-grid { grid-template-columns: 1fr; }
        .related-card > img, .related-placeholder { height: 190px; }
        .article-footer { flex-wrap: wrap; padding: 22px 18px; }
        .article-footer p { order: 3; width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .loading-orb { animation: none; }
        .related-card, .share-button, .article-primary-button { transition: none; }
      }
    `}</style>
  );
}
