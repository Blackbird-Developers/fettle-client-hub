import { useEffect, ReactNode } from "react";
import { useParams, Navigate, NavLink } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { ArticleFeedback } from "@/components/help/ArticleFeedback";
import {
  getArticleBySlug,
  getRelatedArticles,
  CATEGORY_LABELS,
} from "@/data/helpArticles";
import { useAuth } from "@/contexts/AuthContext";

function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*(.+)\*\*$/);
    if (m) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {m[1]}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const PROTECTED_ROUTES = ["/dashboard", "/sessions", "/invoices", "/profile"];

function needsAuth(href: string): boolean {
  return PROTECTED_ROUTES.some((r) => href.startsWith(r));
}

export default function HelpArticle() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const article = slug ? getArticleBySlug(slug) : null;

  useEffect(() => {
    window.scrollTo(0, 0);
    if (article) {
      document.title = `${article.title} | Fettle Help Center`;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute("content", article.summary);
    }
    return () => {
      document.title = "Fettle";
    };
  }, [slug, article]);

  if (!article) return <Navigate to="/help" replace />;

  const Icon = article.icon;
  const related = getRelatedArticles(article);
  const cta = user ? article.primaryCta.loggedIn : article.primaryCta.loggedOut;

  const ctaHref =
    !user && !cta.external && needsAuth(cta.href)
      ? `/login?returnTo=${encodeURIComponent(cta.href)}`
      : cta.href;

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto">
        <NavLink
          to="/help"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 animate-fade-in"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Help Center
        </NavLink>

        <div
          className="mb-8 animate-fade-in"
          style={{ animationDelay: "0.05s" }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <Badge variant="secondary">
              {CATEGORY_LABELS[article.category]}
            </Badge>
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-3">
            {article.title}
          </h1>
          <p className="text-lg text-muted-foreground">{article.summary}</p>
        </div>

        <Card
          className="border-border/50 mb-6 animate-fade-in"
          style={{ animationDelay: "0.1s" }}
        >
          <CardContent className="p-6 sm:p-8 space-y-8">
            <p className="text-foreground leading-relaxed">
              {renderInline(article.intro)}
            </p>

            {article.sections.map((section, i) => (
              <div key={i} className="space-y-3">
                <h2 className="font-heading text-xl font-semibold text-foreground">
                  {renderInline(section.heading)}
                </h2>
                {section.paragraphs?.map((p, j) => (
                  <p key={j} className="text-foreground leading-relaxed">
                    {renderInline(p)}
                  </p>
                ))}
                {section.items && (
                  <ul className="space-y-2 pl-1">
                    {section.items.map((item, j) => (
                      <li
                        key={j}
                        className="flex gap-2.5 text-foreground leading-relaxed"
                      >
                        <span className="text-primary mt-1.5 shrink-0">•</span>
                        <span>{renderInline(item)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.note && (
                  <p className="text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                    {renderInline(section.note)}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card
          className="border-primary/30 bg-primary/5 mb-6 animate-fade-in"
          style={{ animationDelay: "0.15s" }}
        >
          <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-foreground mb-1">
                Ready to take the next step?
              </p>
              <p className="text-sm text-muted-foreground">
                {user
                  ? "We can help you get started right now."
                  : "Log in or create an account to continue."}
              </p>
            </div>
            <Button asChild size="lg" className="shrink-0">
              {cta.external ? (
                <a href={ctaHref} target="_blank" rel="noopener noreferrer">
                  {cta.label}
                  <ExternalLink className="h-4 w-4 ml-2" />
                </a>
              ) : (
                <NavLink to={ctaHref}>
                  {cta.label}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </NavLink>
              )}
            </Button>
          </CardContent>
        </Card>

        <div
          className="mb-6 animate-fade-in"
          style={{ animationDelay: "0.2s" }}
        >
          <ArticleFeedback articleSlug={article.slug} />
        </div>

        {related.length > 0 && (
          <div
            className="animate-fade-in"
            style={{ animationDelay: "0.25s" }}
          >
            <h3 className="font-heading text-lg font-semibold text-foreground mb-4">
              Related articles
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {related.map((r) => (
                <NavLink
                  key={r.slug}
                  to={`/help/${r.slug}`}
                  className="block p-4 rounded-xl border border-border/50 hover:border-primary/50 transition-all group"
                >
                  <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                    {r.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {r.summary}
                  </p>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
