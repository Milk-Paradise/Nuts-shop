function matchesField(value: number, field: string, min: number, max: number) {
  return field.split(",").some((part) => {
    const [range, stepText] = part.split("/")
    const step = stepText ? Number(stepText) : 1
    if (!Number.isInteger(step) || step < 1) return false

    const [startText, endText] = range === "*" ? [String(min), String(max)] : range.split("-")
    const start = Number(startText)
    const end = Number(endText ?? startText)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      return false
    }

    return value >= start && value <= end && (value - start) % step === 0
  })
}

export function isCronDue(expression: string, date: Date) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5 || Number.isNaN(date.getTime())) return false

  const ranges = [
    [date.getMinutes(), 0, 59],
    [date.getHours(), 0, 23],
    [date.getDate(), 1, 31],
    [date.getMonth() + 1, 1, 12],
    [date.getDay(), 0, 6],
  ] as const

  return ranges.every(([value, min, max], index) =>
    matchesField(value, fields[index], min, max)
  )
}
