import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn text-sm font-medium transition-all duration-star ease-star disabled:pointer-events-none disabled:opacity-50 min-h-[44px] px-4',
  {
    variants: {
      variant: {
        primary: 'bg-accent-400 text-space-900 hover:brightness-110 shadow-glow',
        secondary: 'bg-space-700 text-hi hover:bg-space-700/80 border border-space-700',
        ghost: 'text-lo hover:text-hi hover:bg-space-800',
        outline: 'border border-accent-400/40 text-accent-300 hover:bg-accent-400/10',
        danger: 'bg-star-red/15 text-star-red border border-star-red/40 hover:bg-star-red/25',
      },
      size: {
        sm: 'min-h-[36px] px-3 text-xs',
        md: 'min-h-[44px] px-4',
        lg: 'min-h-[52px] px-6 text-base',
        icon: 'min-h-[44px] w-[44px] p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
