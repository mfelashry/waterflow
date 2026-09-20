"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-[#4cc9f0]/60 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[#38bdf8] text-[#03151f] hover:bg-[#5fccfa] shadow-[0_8px_24px_-12px_rgba(76,201,240,0.9)]",
        outline:
          "border border-white/14 bg-[rgba(4,8,14,0.78)] text-[#dce7f5] backdrop-blur-xl hover:border-[rgba(56,189,248,0.6)] hover:text-white",
        ghost: "text-[#8ea3c0] hover:bg-[rgba(120,152,196,0.12)] hover:text-[#e9eff8]",
        subtle:
          "bg-[rgba(120,152,196,0.1)] text-[#cfdcee] hover:bg-[rgba(120,152,196,0.18)]",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "h-9 px-4 [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
