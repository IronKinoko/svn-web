import { randomInt } from 'node:crypto'

const locationIdAlphabet = [
  '0123456789',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
].join('')
const locationIdPattern = /^[A-Za-z0-9]{2}$/

export function isValidLocationId(value: string) {
  return locationIdPattern.test(value)
}

export function generateLocationId(usedIds: ReadonlySet<string> = new Set()) {
  let id = ''
  do {
    id = Array.from(
      { length: 2 },
      () => locationIdAlphabet[randomInt(locationIdAlphabet.length)]!,
    ).join('')
  } while (usedIds.has(id))
  return id
}
