import { promisify } from 'util'
import fs from 'fs'

import Boxes from './box'
const { Box } = Boxes

class File {
  static async fromFs (path) {
    const buffer = await promisify(fs.readFile)(path)
    return File.fromBuffer(buffer)
  }

  static fromBuffer (buffer) {
    const file = new File()

    let offset = 0
    while (offset < buffer.length) {
      const box = Box.parseBox(buffer.slice(offset, buffer.length))
      file.appendBox(box)
      offset += box.size
    }
    return file
  }

  constructor (boxes = []) {
    this.boxes = boxes
  }

  appendBox (box) {
    this.boxes.push(box)
  }

  listUnimplementedBoxTypes () {
    const res = {}

    for (let box of this.boxes) {
      const list = box.listUnimplementedBoxTypes()
      for (let type of Object.keys(list)) {
        res[type] = (res[type] || 0) + list[type]
      }
    }

    const list = []
    for (let type of Object.keys(res)) {
      list.push({ type, occurrence: res[type] })
    }

    return list
  }
}

export default File
