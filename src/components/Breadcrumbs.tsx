import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

const Breadcrumbs = ({ items, className = "" }: BreadcrumbsProps) => {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-2 text-xs tracking-[0.15em] uppercase ${className}`}
      style={{ fontFamily: "var(--font-heading)" }}
    >
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground transition-colors duration-500 flex items-center"
        aria-label="Home"
      >
        <Home className="h-3 w-3" />
      </Link>
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-2">
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          {item.to ? (
            <Link
              to={item.to}
              className="text-muted-foreground hover:text-foreground transition-colors duration-500"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
};

export default Breadcrumbs;
