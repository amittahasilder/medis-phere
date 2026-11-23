
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Clock3,
  Eye,
  HeartPulse,
  Search,
  Sparkles,
  TrendingUp,
  X,
  Tag,
  Activity,
  ShieldCheck,
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
  is_featured?: boolean;
  published_at?: string | null;
  view_count?: number;
  author_name?: string | null;
  author_full_name?: string | null;
};

const categories = [
  "All Articles",
  "Heart Health",
  "Mental Health",
  "Nutrition",
  "Fitness",
  "Women's Health",
  "Kids Healthcare",
  "Disease Guide",
  "Healthy Lifestyle",
];

function readingTime(content?: string | null) {
  const text = (content || "").replace(/<[^>]*>/g, " ").trim();
  const words = text ? text.split(/\s+/).length : 0;
  return `${Math.max(1, Math.ceil(words / 200))} min read`;
}

function formatDate(date?: string | null) {
  if (!date) return "Recently published";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return "Recently published";
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getExcerpt(post: BlogPost) {
  if (post.excerpt) return post.excerpt;

  const content = (post.content || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return content.slice(0, 155) ||
    "Explore expert insights and practical healthcare advice.";
}

function normalizeCategory(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

export default function BlogPage() {
  const reduceMotion = useReducedMotion();

  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All Articles");
  const [page, setPage] = useState(1);

  const pageSize = 6;

  useEffect(() => {
    const controller = new AbortController();

    async function loadPosts() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch("/api/blog?limit=50&page=1", {
          cache: "no-store",
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok || result.success === false) {
          throw new Error(result.message || "Unable to load articles.");
        }

        const data =
          result.posts ??
          result.blogs ??
          result.data ??
          [];

        if (!Array.isArray(data)) {
          throw new Error("Invalid article response from server.");
        }

        setPosts(data);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message || "Something went wrong.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadPosts();

    return () => controller.abort();
  }, []);

  const filteredPosts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return posts.filter((post) => {
      const matchesSearch =
        !query ||
        post.title?.toLowerCase().includes(query) ||
        post.excerpt?.toLowerCase().includes(query) ||
        post.content?.toLowerCase().includes(query) ||
        post.category?.toLowerCase().includes(query) ||
        post.tags?.some((tag) =>
          tag.toLowerCase().includes(query)
        );

      const matchesCategory =
        activeCategory === "All Articles" ||
        normalizeCategory(post.category) ===
          normalizeCategory(activeCategory);

      return matchesSearch && matchesCategory;
    });
  }, [posts, search, activeCategory]);

  const featured =
    filteredPosts.find((post) => post.is_featured) ||
    filteredPosts[0];

  const remainingPosts = filteredPosts.filter(
    (post) => post.id !== featured?.id
  );

  const totalPages = Math.max(
    1,
    Math.ceil(remainingPosts.length / pageSize)
  );

  const visiblePosts = remainingPosts.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  function changeCategory(category: string) {
    setActiveCategory(category);
    setPage(1);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  const animation = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 25 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true },
        transition: { duration: 0.55 },
      };

  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f9f7] text-[#102b2a]">

      <style jsx global>{`
        html {
          scroll-behavior: smooth;
        }

        @keyframes blogFloat {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-15px) rotate(2deg);
          }
        }

        @keyframes blogGlow {
          0%, 100% {
            opacity: .35;
            transform: scale(1);
          }
          50% {
            opacity: .75;
            transform: scale(1.12);
          }
        }

        @keyframes blogPulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(91, 229, 190, .25);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(91, 229, 190, 0);
          }
        }

        .blog-float {
          animation: blogFloat 7s ease-in-out infinite;
        }

        .blog-glow {
          animation: blogGlow 8s ease-in-out infinite;
        }

        .blog-pulse {
          animation: blogPulse 3s infinite;
        }

        .blog-glass {
          background: rgba(255, 255, 255, .12);
          border: 1px solid rgba(255, 255, 255, .24);
          backdrop-filter: blur(22px);
          -webkit-backdrop-filter: blur(22px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, .12);
        }

        .blog-card {
          transform-style: preserve-3d;
          transition:
            transform .4s ease,
            box-shadow .4s ease,
            border-color .4s ease;
        }

        .blog-card:hover {
          transform:
            perspective(1000px)
            rotateX(2deg)
            rotateY(-2deg)
            translateY(-8px);
          box-shadow: 0 25px 65px rgba(15, 65, 58, .13);
          border-color: rgba(8, 135, 118, .3);
        }

        .blog-grid {
          background-image:
            radial-gradient(
              rgba(255,255,255,.17) 1px,
              transparent 1px
            );
          background-size: 24px 24px;
        }

        .blog-scroll::-webkit-scrollbar {
          display: none;
        }

        .blog-scroll {
          scrollbar-width: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .blog-float,
          .blog-glow,
          .blog-pulse {
            animation: none !important;
          }

          .blog-card {
            transition: none !important;
          }
        }
      `}</style>

      {/* NAVIGATION */}

      <header className="sticky top-0 z-50 border-b border-white/60 bg-white/75 backdrop-blur-2xl shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">

          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0b9b85] to-[#075b52] text-white shadow-lg shadow-teal-900/20">
              <HeartPulse size={24} />
            </span>

            <span className="text-xl font-black tracking-tight">
              Medi<span className="text-[#078675]">Sphere</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
            <Link href="/" className="transition hover:text-[#078675]">
              Home
            </Link>

            <Link href="/doctors" className="transition hover:text-[#078675]">
              Find Doctors
            </Link>

            <Link href="/blog" className="text-[#078675]">
              Health Blog
            </Link>

            <Link href="/books" className="transition hover:text-[#078675]">
              Books
            </Link>
          </nav>

          <Link
            href="/"
            className="flex items-center gap-2 rounded-full bg-[#087f70] px-5 py-3 text-xs font-bold text-white shadow-lg shadow-teal-900/15 transition hover:-translate-y-0.5 hover:bg-[#06675b] sm:text-sm"
          >
            Get Healthcare
            <ArrowUpRight size={16} />
          </Link>

        </div>
      </header>

      {/* HERO */}

      <section className="relative overflow-hidden bg-[#063b37] text-white">

        <div className="blog-grid absolute inset-0 opacity-60" />

        <div className="blog-glow absolute -right-40 -top-40 h-[550px] w-[550px] rounded-full bg-[#11a98d]/35 blur-[110px]" />

        <div className="blog-glow absolute -bottom-64 -left-40 h-[500px] w-[500px] rounded-full bg-cyan-400/20 blur-[110px]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 md:grid-cols-2 md:py-28 lg:px-8">

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, x: -35 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >

            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[.17em] text-teal-100 backdrop-blur-xl">
              <Sparkles size={15} />
              Your health, your knowledge
            </div>

            <h1 className="max-w-2xl text-5xl font-black leading-[1.08] tracking-tight md:text-6xl lg:text-7xl">
              Knowledge is the

              <span className="block bg-gradient-to-r from-[#5ce1c4] via-[#a5f2df] to-white bg-clip-text text-transparent">
                best medicine.
              </span>
            </h1>

            <p className="mt-7 max-w-xl text-base leading-8 text-teal-50/75 md:text-lg">
              Discover trusted health insights, expert medical advice,
              and practical wellness guides to help you live a healthier life.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-4">

              <a
                href="#articles"
                className="inline-flex items-center gap-3 rounded-full bg-[#55ddbd] px-7 py-4 font-bold text-[#073d3a] shadow-xl shadow-black/10 transition hover:-translate-y-1 hover:bg-[#7be9d0]"
              >
                Explore Articles
                <ArrowRight size={18} />
              </a>

              <div className="flex items-center gap-2 text-sm text-teal-100/80">
                <ShieldCheck size={19} />
                Health knowledge for everyone
              </div>

            </div>

            <div className="mt-12 flex flex-wrap gap-8 border-t border-white/15 pt-7">

              <div>
                <div className="flex items-center gap-2 text-2xl font-black">
                  <BookOpen size={20} className="text-[#69e6c6]" />
                  Knowledge
                </div>
                <p className="mt-1 text-xs text-teal-100/60">
                  Learn about your health
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-2xl font-black">
                  <Activity size={20} className="text-[#69e6c6]" />
                  Wellness
                </div>
                <p className="mt-1 text-xs text-teal-100/60">
                  Build healthier habits
                </p>
              </div>

            </div>

          </motion.div>

          {/* GLASS HERO VISUAL */}

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.8, rotate: 5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.15 }}
            className="relative mx-auto w-full max-w-[470px]"
          >

            <div className="blog-float blog-glass relative rounded-[2.5rem] p-4">

              <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#dcfff3] via-[#b5eee0] to-[#77d3bd] p-8 text-[#07534a]">

                <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/40 blur-3xl" />

                <div className="relative flex items-center justify-between">

                  <span className="rounded-full border border-white/60 bg-white/60 px-4 py-2 text-xs font-bold backdrop-blur">
                    HEALTH & WELLNESS
                  </span>

                  <HeartPulse size={25} />

                </div>

                <div className="relative flex min-h-[285px] flex-col justify-center">

                  <div className="relative mx-auto flex h-44 w-44 items-center justify-center rounded-full border border-white/70 bg-white/30 shadow-inner backdrop-blur-xl">

                    <div className="absolute inset-4 rounded-full border border-white/80" />

                    <div className="absolute inset-8 rounded-full border border-white/60" />

                    <HeartPulse size={92} strokeWidth={1.1} />

                    <span className="absolute -right-3 top-5 rounded-2xl bg-white p-3 shadow-xl">
                      <Sparkles size={22} className="text-[#07957e]" />
                    </span>

                  </div>

                  <h2 className="mt-8 text-center text-3xl font-black">
                    Live Well. Feel Better.
                  </h2>

                  <p className="mt-2 text-center text-sm text-[#176c60]">
                    Small steps. Healthier tomorrows.
                  </p>

                </div>

              </div>

            </div>

            <div className="absolute -left-8 top-16 hidden rounded-2xl blog-glass p-4 sm:block">
              <TrendingUp size={25} className="text-[#72f0ce]" />
              <p className="mt-2 text-xs font-bold">Better choices</p>
              <p className="text-[10px] text-teal-100/70">
                Every single day
              </p>
            </div>

            <div className="absolute -bottom-7 -right-5 rounded-2xl blog-glass p-4">

              <div className="flex items-center gap-2">
                <span className="blog-pulse h-2.5 w-2.5 rounded-full bg-[#6ef0bd]" />
                <span className="text-xs font-bold">
                  Trusted knowledge
                </span>
              </div>

              <p className="mt-1 text-[10px] text-teal-100/70">
                Your wellness companion
              </p>

            </div>

          </motion.div>

        </div>
      </section>

      {/* SEARCH AND CATEGORIES */}

      <section
        id="articles"
        className="relative z-10 mx-auto -mt-8 max-w-7xl px-5 lg:px-8"
      >

        <div className="rounded-[2rem] border border-white/80 bg-white/85 p-5 shadow-2xl shadow-[#164b3e]/10 backdrop-blur-2xl md:p-8">

          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">

            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-[#078675]">
                Explore our library
              </p>

              <h2 className="mt-1 text-2xl font-black">
                Find your next read
              </h2>
            </div>

            <div className="relative w-full md:max-w-md">

              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={19}
              />

              <input
                value={search}
                onChange={(e) => changeSearch(e.target.value)}
                placeholder="Search health topics, articles..."
                className="w-full rounded-2xl border border-slate-200/80 bg-[#f8fbf9] py-4 pl-12 pr-11 text-sm outline-none transition focus:border-[#078675] focus:ring-4 focus:ring-teal-500/10"
              />

              {search && (
                <button
                  type="button"
                  onClick={() => changeSearch("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label="Clear search"
                >
                  <X size={18} />
                </button>
              )}

            </div>

          </div>

          <div className="blog-scroll mt-7 flex gap-2 overflow-x-auto pb-1">

            {categories.map((category) => (

              <button
                key={category}
                type="button"
                onClick={() => changeCategory(category)}
                className={`shrink-0 rounded-full px-5 py-3 text-xs font-bold transition ${
                  activeCategory === category
                    ? "bg-gradient-to-r from-[#087f70] to-[#0aa58a] text-white shadow-lg shadow-teal-900/20"
                    : "bg-[#f0f6f3] text-slate-600 hover:bg-[#dcefe8] hover:text-[#087f70]"
                }`}
              >
                {category}
              </button>

            ))}

          </div>

        </div>
      </section>

      {/* FEATURED ARTICLE */}

      <section className="mx-auto max-w-7xl px-5 pb-12 pt-16 lg:px-8">

        <div className="mb-8 flex items-end justify-between">

          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#078675]">
              <Sparkles size={15} />
              Editor's selection
            </div>

            <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Featured story
            </h2>
          </div>

          <span className="hidden text-sm text-slate-400 sm:block">
            Handpicked for your wellbeing
          </span>

        </div>

        {loading ? (

          <div className="grid min-h-[340px] animate-pulse overflow-hidden rounded-[2rem] bg-[#e7f0ec] md:grid-cols-2">
            <div className="bg-[#d8e9e2]" />
            <div className="p-10">
              <div className="h-5 w-32 rounded bg-[#cbded5]" />
              <div className="mt-8 h-10 w-full rounded bg-[#cbded5]" />
              <div className="mt-4 h-5 w-4/5 rounded bg-[#cbded5]" />
            </div>
          </div>

        ) : featured ? (

          <motion.article
            {...animation}
            className="blog-card group grid overflow-hidden rounded-[2rem] border border-white bg-white shadow-xl shadow-[#164b3e]/5 md:grid-cols-2"
          >

            <div className="relative min-h-[300px] overflow-hidden bg-gradient-to-br from-[#0d655a] to-[#b2e9d9]">

              {featured.featured_image_url ? (

                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={featured.featured_image_url}
                  alt={featured.title}
                  className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />

              ) : (

                <div className="flex h-full min-h-[300px] items-center justify-center">
                  <HeartPulse
                    size={115}
                    strokeWidth={0.8}
                    className="text-white/80"
                  />
                </div>

              )}

              <div className="absolute left-6 top-6 rounded-full border border-white/60 bg-white/85 px-4 py-2 text-xs font-black text-[#087f70] shadow-lg backdrop-blur-xl">
                FEATURED ARTICLE
              </div>

            </div>

            <div className="flex flex-col justify-center p-7 md:p-12">

              <span className="w-fit rounded-full border border-teal-100 bg-[#e8f6f0] px-4 py-2 text-xs font-bold text-[#078675]">
                {featured.category || "Health & Wellness"}
              </span>

              <h3 className="mt-5 text-3xl font-black leading-tight tracking-tight md:text-4xl">
                {featured.title}
              </h3>

              <p className="mt-5 line-clamp-3 text-sm leading-7 text-slate-500">
                {getExcerpt(featured)}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-4 text-xs text-slate-400">

                <span className="flex items-center gap-1.5">
                  <CalendarDays size={15} />
                  {formatDate(featured.published_at)}
                </span>

                <span className="flex items-center gap-1.5">
                  <Clock3 size={15} />
                  {readingTime(featured.content)}
                </span>

                <span className="flex items-center gap-1.5">
                  <Eye size={15} />
                  {featured.view_count || 0} views
                </span>

              </div>

              <Link
                href={`/blog/${featured.slug}`}
                className="mt-8 inline-flex w-fit items-center gap-3 rounded-full bg-gradient-to-r from-[#087f70] to-[#0aa58a] px-7 py-4 text-sm font-bold text-white shadow-lg shadow-teal-900/15 transition hover:gap-5 hover:shadow-xl"
              >
                Read Full Article
                <ArrowRight size={17} />
              </Link>

            </div>

          </motion.article>

        ) : (

          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <BookOpen className="mx-auto text-[#078675]" size={38} />
            <h3 className="mt-4 text-xl font-bold">
              No featured article found
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Publish an article to show it here.
            </p>
          </div>

        )}

      </section>

      {/* LATEST ARTICLES */}

      <section className="mx-auto max-w-7xl px-5 pb-24 lg:px-8">

        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">

          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#078675]">
              <BookOpen size={15} />
              The latest knowledge
            </p>

            <h2 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Latest articles
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Discover stories and insights for a healthier you.
            </p>
          </div>

          <div className="rounded-full border border-teal-100 bg-[#e8f5ef] px-4 py-2 text-xs font-bold text-[#087f70]">
            {filteredPosts.length} articles found
          </div>

        </div>

        {error && (

          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error}
          </div>

        )}

        {loading ? (

          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">

            {[1, 2, 3, 4, 5, 6].map((item) => (

              <div
                key={item}
                className="animate-pulse overflow-hidden rounded-3xl bg-white"
              >
                <div className="h-56 bg-[#e1eee7]" />
                <div className="p-6">
                  <div className="h-4 w-24 rounded bg-[#e1eee7]" />
                  <div className="mt-5 h-6 rounded bg-[#e1eee7]" />
                  <div className="mt-3 h-4 w-4/5 rounded bg-[#e1eee7]" />
                </div>
              </div>

            ))}

          </div>

        ) : visiblePosts.length > 0 ? (

          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">

            {visiblePosts.map((post, index) => (

              <motion.article
                key={post.id}
                initial={reduceMotion ? false : { opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.45,
                  delay: reduceMotion ? 0 : index * 0.07,
                }}
                className="blog-card group overflow-hidden rounded-3xl border border-white bg-white shadow-lg shadow-[#164b3e]/[.05]"
              >

                <Link
                  href={`/blog/${post.slug}`}
                  className="block"
                  aria-label={`Read ${post.title}`}
                >

                  <div className="relative h-56 overflow-hidden bg-gradient-to-br from-[#d8f1e7] to-[#91d5c0]">

                    {post.featured_image_url ? (

                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={post.featured_image_url}
                        alt={post.title}
                        className="h-full w-full object-cover transition duration-700 group-hover:scale-110"
                      />

                    ) : (

                      <div className="flex h-full items-center justify-center">
                        <HeartPulse
                          size={70}
                          strokeWidth={1}
                          className="text-[#087f70]/60"
                        />
                      </div>

                    )}

                    <span className="absolute left-5 top-5 rounded-full border border-white/70 bg-white/85 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-[#087f70] shadow-lg backdrop-blur-xl">
                      {post.category || "Health"}
                    </span>

                  </div>

                </Link>

                <div className="p-6">

                  <div className="flex items-center gap-3 text-[11px] font-medium text-slate-400">

                    <span className="flex items-center gap-1">
                      <CalendarDays size={13} />
                      {formatDate(post.published_at)}
                    </span>

                    <span className="h-1 w-1 rounded-full bg-slate-300" />

                    <span className="flex items-center gap-1">
                      <Clock3 size={13} />
                      {readingTime(post.content)}
                    </span>

                  </div>

                  <Link href={`/blog/${post.slug}`}>
                    <h3 className="mt-4 line-clamp-2 text-xl font-extrabold leading-snug transition group-hover:text-[#078675]">
                      {post.title}
                    </h3>
                  </Link>

                  <p className="mt-3 line-clamp-3 text-sm leading-7 text-slate-500">
                    {getExcerpt(post)}
                  </p>

                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">

                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Eye size={14} />
                      {post.view_count || 0} views
                    </span>

                    <Link
                      href={`/blog/${post.slug}`}
                      className="inline-flex items-center gap-2 text-xs font-black text-[#078675] transition group-hover:gap-3"
                    >
                      Read More
                      <ArrowUpRight size={16} />
                    </Link>

                  </div>

                </div>

              </motion.article>

            ))}

          </div>

        ) : (

          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">

            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e8f5ef] text-[#087f70]">
              <Search size={27} />
            </div>

            <h3 className="mt-5 text-xl font-black">
              No articles found
            </h3>

            <p className="mt-2 text-sm text-slate-500">
              Try another search or select a different category.
            </p>

            <button
              type="button"
              onClick={() => {
                changeSearch("");
                changeCategory("All Articles");
              }}
              className="mt-6 rounded-full bg-[#087f70] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#06675b]"
            >
              Clear filters
            </button>

          </div>

        )}

        {/* PAGINATION */}

        {!loading && visiblePosts.length > 0 && totalPages > 1 && (

          <div className="mt-12 flex items-center justify-center gap-4">

            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((current) => current - 1)}
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold transition hover:border-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>

            <span className="text-sm font-bold text-slate-500">
              {page} / {totalPages}
            </span>

            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-bold transition hover:border-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>

          </div>

        )}

      </section>

      {/* CALL TO ACTION */}

      <section className="px-5 pb-20 lg:px-8">

        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[#063b37] px-7 py-16 text-center text-white shadow-2xl shadow-teal-900/10 md:px-16">

          <div className="blog-glow absolute -right-20 -top-36 h-80 w-80 rounded-full bg-teal-400/25 blur-[90px]" />

          <div className="blog-glow absolute -bottom-36 -left-20 h-80 w-80 rounded-full bg-cyan-400/15 blur-[90px]" />

          <div className="relative">

            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-[#69e6c6] backdrop-blur-xl">
              <HeartPulse size={32} />
            </span>

            <h2 className="mt-7 text-3xl font-black md:text-4xl">
              Your health journey starts with knowledge.
            </h2>

            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-teal-50/70">
              Explore trusted healthcare resources and make informed
              decisions for you and your family.
            </p>

            <Link
              href="/"
              className="mt-8 inline-flex items-center gap-3 rounded-full bg-[#55ddbd] px-7 py-4 text-sm font-black text-[#073d3a] shadow-xl transition hover:-translate-y-1 hover:bg-[#7be9d0]"
            >
              Explore MediSphere
              <ArrowRight size={18} />
            </Link>

          </div>

        </div>

      </section>

      {/* FOOTER */}

      <footer className="border-t border-[#e5eee9] bg-white/90 backdrop-blur-xl">

        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-5 py-8 text-sm text-slate-400 md:flex-row md:items-center lg:px-8">

          <Link
            href="/"
            className="text-lg font-black text-[#102b2a]"
          >
            Medi<span className="text-[#078675]">Sphere</span>
          </Link>

          {/* Static year prevents Next.js 16 prerender error */}
          <p>
            © 2026 MediSphere. Healthcare knowledge for everyone.
          </p>

          <span className="flex items-center gap-2">
            <Tag size={14} />
            Learn. Prevent. Thrive.
          </span>

        </div>

      </footer>

    </main>
  );
}
