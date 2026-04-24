import { useState, useMemo, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, HelpCircle } from "lucide-react";
import { ArticleCard } from "@/components/help/ArticleCard";
import {
  helpArticles,
  HelpCategory,
  CATEGORY_LABELS,
  getAvailableCategories,
} from "@/data/helpArticles";

export default function HelpCenter() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<HelpCategory | "all">(
    "all"
  );

  const availableCategories = useMemo(() => getAvailableCategories(), []);

  useEffect(() => {
    document.title = "Help Center | Fettle";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute(
        "content",
        "Help Center for Fettle clients — booking therapy, packages, billing, privacy, and more."
      );
    }
    return () => {
      document.title = "Fettle";
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return helpArticles.filter((article) => {
      const matchesCategory =
        activeCategory === "all" || article.category === activeCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q) ||
        article.intro.toLowerCase().includes(q) ||
        article.sections.some((s) => s.heading.toLowerCase().includes(q))
      );
    });
  }, [query, activeCategory]);

  return (
    <DashboardLayout>
      <div className="mb-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Help Center
          </h1>
        </div>
        <p className="text-muted-foreground">
          Find answers about booking, sessions, packages, and more.
        </p>
      </div>

      <div
        className="relative mb-5 animate-fade-in"
        style={{ animationDelay: "0.05s" }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help articles..."
          className="pl-10 h-11"
        />
      </div>

      <div
        className="flex flex-wrap gap-2 mb-6 animate-fade-in"
        style={{ animationDelay: "0.1s" }}
      >
        <Button
          variant={activeCategory === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveCategory("all")}
        >
          All
        </Button>
        {availableCategories.map((cat) => (
          <Button
            key={cat}
            variant={activeCategory === cat ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </Button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6">
          {filtered.map((article, i) => (
            <ArticleCard
              key={article.slug}
              article={article}
              animationDelay={`${0.15 + i * 0.05}s`}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 animate-fade-in">
          <div className="p-4 rounded-full bg-muted/50 inline-block mb-4">
            <Search className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
            No articles found
          </h3>
          <p className="text-muted-foreground">
            Try a different search or category. You can always contact us at{" "}
            <a
              href="mailto:hello@fettle.ie"
              className="text-primary hover:underline font-medium"
            >
              hello@fettle.ie
            </a>
            .
          </p>
        </div>
      )}
    </DashboardLayout>
  );
}
