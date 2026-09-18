import { expect, test } from 'bun:test'
import { parseSearch } from './search'

test('operators, quotes and plain text', () => {
  expect(parseSearch('fix @:ann ?:src/*.ts "two words" ~:"foo bar"')).toEqual({
    message: ['fix', 'two words'],
    author: ['ann'],
    commit: [],
    file: ['src/*.ts'],
    changes: ['foo bar'],
    matchCase: false,
  })
})

test('a lone sha searches commits', () => {
  expect(parseSearch('abc1234').commit).toEqual(['abc1234'])
  expect(parseSearch('message:"a b" author:x').message).toEqual(['a b'])
})
