import Image from "next/image";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image src="/tradejournal-tj-rounded.png" alt="" width={64} height={64} className={className} />
  );
}
