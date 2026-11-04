import { beforeAll, expect, it } from 'vitest'
import { i18n } from '../i18n'
import { handled, handlerError } from './handler-error'

beforeAll(() => i18n.changeLanguage('fr'))

it('code and dialog text', async () => {
  const e = handlerError(new Error('bc:notOpen||Clients'))
  expect(e.code).toBe('notOpen')
  expect(e.message).toBe("« Clients » n'est pas ouvert.")
  expect(handlerError(new Error('boom')).code).toBe('Error')
  await expect(handled(async () => { throw new Error('bc:notOpen||X') })([])).rejects.toMatchObject({ code: 'notOpen' })
})
