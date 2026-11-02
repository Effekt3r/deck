import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileThumbnail, imageInfo } from './image'

/** A stand-in for Electron's nativeImage: an image is just its size, and its PNG is that size as
 *  JSON, which createFromBuffer decodes back. */
const native = vi.hoisted(() => {
  interface Fake {
    getSize(): { width: number; height: number }
    isEmpty(): boolean
    resize(o: { width: number }): Fake
    toDataURL(): string
    toPNG(): Buffer
  }
  const fake = (width: number, height: number): Fake => ({
    getSize: () => ({ width, height }),
    isEmpty: () => false,
    resize: (o) => fake(o.width, Math.round((height * o.width) / width)),
    toDataURL: () => `data:${width}x${height}`,
    toPNG: () => Buffer.from(JSON.stringify({ width, height })),
  })
  return { fake, thumbnail: vi.fn() }
})

vi.mock('electron', () => ({
  nativeImage: {
    createThumbnailFromPath: native.thumbnail,
    createFromBuffer: (png: Buffer) => {
      const { width, height } = JSON.parse(png.toString())
      return native.fake(width, height)
    },
  },
}))

const dir = mkdtempSync(join(tmpdir(), 'deck-thumbs-'))
const file = (name: string, bytes = 'x') => {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

/** What Electron 45 hands back on macOS when asked for 480×560: an image that claims the whole box
 *  (its own resize() is stretched to it), whose 1× PNG has the image's real shape. */
const quickLook = (png: { width: number; height: number }) => ({
  ...native.fake(480, 560),
  toPNG: () => Buffer.from(JSON.stringify(png)),
})

// Braces: a function returned from beforeEach is run as the test's teardown, and mockReset()
// returns the mock itself.
beforeEach(() => {
  native.thumbnail.mockReset()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('imageInfo', () => {
  it("is the image's size and a thumbnail that fits 240×280", () => {
    expect(imageInfo(Buffer.from(JSON.stringify({ width: 1440, height: 900 })))).toEqual({
      width: 1440, height: 900, thumbnail: 'data:240x150',
    })
    expect(imageInfo(Buffer.from(JSON.stringify({ width: 50, height: 30 })))).toMatchObject({ thumbnail: 'data:50x30' })
  })
})

describe('fileThumbnail', () => {
  it("fits the 1× PNG of the OS's thumbnail into 240×280, not the stretched image it claims to be", async () => {
    native.thumbnail.mockResolvedValue(quickLook({ width: 480, height: 320 }))
    const photo = file('photo.jpg')
    await expect(fileThumbnail(photo, 'darwin')).resolves.toBe('data:240x160')
    expect(native.thumbnail).toHaveBeenCalledWith(photo, { width: 480, height: 560 })
  })

  it('has none for a folder, an empty file or a missing one, and never asks the OS about them', async () => {
    const folder = join(dir, 'folder.png')
    mkdirSync(folder)
    for (const path of [folder, file('empty.png', ''), join(dir, 'missing.png')]) {
      await expect(fileThumbnail(path, 'darwin')).resolves.toBe('')
    }
    expect(native.thumbnail).not.toHaveBeenCalled()
  })

  it('has none when the OS makes none: a rejection, or no thumbnailer at all (Linux)', async () => {
    native.thumbnail.mockRejectedValue(new Error('unable to retrieve thumbnail preview image'))
    await expect(fileThumbnail(file('a.png'), 'win32')).resolves.toBe('')
    native.thumbnail.mockImplementation(() => {
      throw new TypeError('nativeImage.createThumbnailFromPath is not a function')
    })
    await expect(fileThumbnail(file('b.png'), 'linux')).resolves.toBe('')
  })

  it("macOS: a result larger than the box is Quick Look's icon for a file it can't preview, so none", async () => {
    native.thumbnail.mockResolvedValue(quickLook({ width: 1024, height: 1024 }))
    await expect(fileThumbnail(file('corrupt.png'), 'darwin')).resolves.toBe('')
  })

  it("Windows: a thumbnail larger than asked (its cache's own size) is fitted, not taken for an icon", async () => {
    native.thumbnail.mockResolvedValue(native.fake(1024, 768))
    await expect(fileThumbnail(file('large.png'), 'win32')).resolves.toBe('data:240x180')
  })
})
