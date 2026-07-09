import LogoLighting from "@/components/LogoLighting";

interface BrandLoaderProps {
  fullScreen?: boolean;
}

const BrandLoader = ({ fullScreen = false }: BrandLoaderProps) => {
  return (
    <div className={`${fullScreen ? "fixed inset-0 z-[100] h-screen-safe" : "min-h-[60vh]"} flex items-center justify-center bg-background`}>
      <LogoLighting sizeClassName="h-40 w-40 md:h-56 md:w-56" pulse />
    </div>
  );
};

export default BrandLoader;
