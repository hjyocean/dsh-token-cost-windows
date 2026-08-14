/** CSS Modules class map (lightningcss compiles `*.module.css` in the bundle). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
