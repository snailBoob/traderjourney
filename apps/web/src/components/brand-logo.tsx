import Image from "next/image";
import { BRAND_LOGO_PATH } from "@/lib/brand-assets";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image src={BRAND_LOGO_PATH} alt="" width={64} height={64} unoptimized className={className} />
  );
}
