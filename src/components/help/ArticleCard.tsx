import { NavLink } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";
import { HelpArticle, CATEGORY_LABELS } from "@/data/helpArticles";

interface ArticleCardProps {
  article: HelpArticle;
  animationDelay?: string;
}

export function ArticleCard({ article, animationDelay }: ArticleCardProps) {
  const Icon = article.icon;
  return (
    <NavLink
      to={`/help/${article.slug}`}
      className="block animate-fade-in"
      style={animationDelay ? { animationDelay } : undefined}
    >
      <Card className="border-border/50 hover:border-primary/50 hover:shadow-soft transition-all h-full group">
        <CardContent className="p-5 sm:p-6 flex flex-col h-full">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-primary/10 shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <Badge variant="secondary" className="text-xs shrink-0">
              {CATEGORY_LABELS[article.category]}
            </Badge>
          </div>
          <h3 className="font-heading text-lg font-semibold text-foreground mb-1.5 group-hover:text-primary transition-colors">
            {article.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed flex-1">
            {article.summary}
          </p>
          <div className="flex items-center gap-1 text-sm font-medium text-primary mt-4">
            Read article
            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </CardContent>
      </Card>
    </NavLink>
  );
}
