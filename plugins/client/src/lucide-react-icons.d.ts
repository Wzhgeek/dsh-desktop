declare module 'lucide-react/dist/esm/icons/*.mjs' {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react'

  interface LucideIconProps extends SVGProps<SVGSVGElement> {
    size?: number | string
    absoluteStrokeWidth?: boolean
  }

  const Icon: ForwardRefExoticComponent<LucideIconProps & RefAttributes<SVGSVGElement>>
  export default Icon
}
