
import { Suspense } from "react";
import BlogArticleClient from "@/components/blog/BlogArticleClient";

export const instant = false;

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

async function BlogArticleContent({ params }: BlogPostPageProps) {
  const { slug } = await params;
  return <BlogArticleClient slug={slug} />;
}

export default function BlogPostPage({ params }: BlogPostPageProps) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-teal-400 border-t-transparent" />
            <p className="text-sm text-slate-300">Loading article...</p>
          </div>
        </main>
      }
    >
      <BlogArticleContent params={params} />
    </Suspense>
  );
}
