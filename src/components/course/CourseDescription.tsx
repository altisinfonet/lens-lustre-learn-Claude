const bodyFont = { fontFamily: "var(--font-body)" };
const headingFont = { fontFamily: "var(--font-heading)" };

interface CourseDescriptionProps {
  description: string | null;
}

const CourseDescription = ({ description }: CourseDescriptionProps) => {
  if (!description) return null;

  // Skip if description is very short (already shown in hero)
  const paragraphs = description.split("\n\n");
  if (paragraphs.length <= 1) return null;

  return (
    <div className="mt-10 md:mt-16">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-px bg-primary" />
        <span
          className="text-[10px] tracking-[0.3em] uppercase text-primary"
          style={headingFont}
        >
          About This Course
        </span>
      </div>

      <div className="max-w-4xl space-y-4">
        {paragraphs.slice(1).map((p, i) => (
          <p
            key={i}
            className="text-sm text-foreground/85 leading-[1.8]"
            style={bodyFont}
          >
            {p}
          </p>
        ))}
      </div>
    </div>
  );
};

export default CourseDescription;
