import { motion } from 'framer-motion'

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  center = true,
}: {
  eyebrow?: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  center?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5 }}
      className={center ? 'text-center mx-auto max-w-2xl' : 'max-w-2xl'}
    >
      {eyebrow && (
        <span className="chip-sprout mb-3 inline-flex">{eyebrow}</span>
      )}
      <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-balance">{title}</h2>
      {subtitle && <p className="mt-3 text-muted-foreground leading-relaxed text-balance">{subtitle}</p>}
    </motion.div>
  )
}
