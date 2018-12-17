/*
aligned(8) class Box (unsigned int(32) boxtype, optional unsigned int(8)[16] extended_type) {
    unsigned int(32) size;
    unsigned int(32) type = boxtype;
    if (size==1) {
        unsigned int(64) largesize;
    } else if (size==0) {
        // box extends to end of file
    }
    if (boxtype==‘uuid’) {
        unsigned int(8)[16] usertype = extended_type;
    }
}

size - is an integer that specifies the number of bytes in this box, including all its fields and
contained boxes; if size is 1 then the actual size is in the field largesize; if size is 0, then this
box is the last one in the file, and its contents extend to the end of the file (normally only used
for a Media Data Box)
type - identifies the box type; standard boxes use a compact type, which is normally four printable
characters, to permit ease of identification, and is shown so in the boxes below. User extensions
use an extended type; in this case, the type field is set to ‘uuid’.
 */
class Box {
  static parseBox (buffer) {
    const type = this.type = buffer.slice(4, 8).toString('ascii')

    const Clazz = Box.implementations[type] || UnimplementedBox

    const box = new Clazz(buffer)

    if (!(box instanceof UnimplementedBox)) {
      while (box._offset < buffer.length) {
        const child = Box.parseBox(buffer.slice(box._offset, buffer.length))
        box.appendChildBox(child)

        box._offset += child.size
      }
    }

    return box
  }

  constructor (buffer) {
    this._offset = 0

    this.size = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.type = buffer.slice(this._offset, this._offset + 4).toString('ascii')
    this._offset += 4

    if (this.size === 1) {
      // TODO: investigate lost in IEEE 64-bit float precision
      // probably okay since 32-bit floating point loses precision on 8PiB
      this.size = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
    } else if (this.size === 0) {
      this.size = buffer.length - 4
    }

    if (this.type === 'uuid') {
      this.usertype = buffer.slice(this._offset, this._offset + 16).toString('ascii')
      this._offset += 16
    }

    this.childBoxes = []
  }

  appendChildBox (box) {
    this.childBoxes.push(box)
  }

  listUnimplementedBoxTypes () {
    const res = {}

    if (this instanceof UnimplementedBox) {
      res[this.type] = 1
      return res
    }

    for (let box of this.childBoxes) {
      const list = box.listUnimplementedBoxTypes()
      for (let type of Object.keys(list)) {
        res[type] = (res[type] || 0) + list[type]
      }
    }

    return res
  }
}

class UnimplementedBox extends Box {
}

/*
aligned(8) class FullBox(unsigned int(32) boxtype, unsigned int(8) v, bit(24) f) extends Box(boxtype) {
    unsigned int(8) version = v;
    bit(24) flags = f;
}

version - is an integer that specifies the version of this format of the box.
flags - is a map of flags
 */
class FullBox extends Box {
  constructor (buffer) {
    super(buffer)

    this.version = buffer.readUInt8(this._offset)
    this._offset += 1

    this.flag = buffer.readUInt8(this._offset) << 16 |
      buffer.readUInt8(this._offset + 1) << 8 |
      buffer.readUInt8(this._offset + 2)
    this._offset += 3
  }
}

/*
aligned(8) class FileTypeBox extends Box(‘ftyp’) {
    unsigned int(32) major_brand;
    unsigned int(32) minor_version;
    unsigned int(32) compatible_brands[]; // to end of the box
}

major_brand – is a brand identifier
minor_version – is an informative integer for the minor version of the major brand
compatible_brands – is a list, to the end of the box, of brands
 */
class FileTypeBox extends Box {
  constructor (buffer) {
    super(buffer)

    this.major_brand = buffer.slice(this._offset, this._offset + 4).toString('ascii')
    this._offset += 4

    this.minor_version = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.compatible_brands = []
    for (; this._offset < this.size; this._offset += 4) {
      this.compatible_brands.push(
        buffer.slice(this._offset, this._offset + 4).toString('ascii'))
    }
  }
}

/*
aligned(8) class MovieBox extends Box(‘moov’){
}
 */
class MovieBox extends Box {
}

/*
aligned(8) class MovieFragmentBox extends Box(‘moof’){
}
 */
class MovieFragmentBox extends Box {
}

/*
aligned(8) class MediaDataBox extends Box(‘mdat’) {
    bit(8) data[];
}

data - is the contained media data
 */
class MediaDataBox extends Box {
  constructor (buffer) {
    super(buffer)

    this.data = buffer.slice(this._offset, buffer.length)
    this._offset = buffer.length
  }
}

/*
aligned(8) class MovieFragmentRandomAccessBox extends Box(‘mfra’) {
}
 */
class MovieFragmentRandomAccessBox extends Box {
}

/*
aligned(8) class MovieHeaderBox extends FullBox(‘mvhd’, version, 0) {
    if (version==1) {
        unsigned int(64) creation_time;
        unsigned int(64) modification_time;
        unsigned int(32) timescale;
        unsigned int(64) duration;
    } else { // version==0
        unsigned int(32) creation_time;
        unsigned int(32) modification_time;
        unsigned int(32) timescale;
        unsigned int(32) duration;
    }
    template int(32) rate = 0x00010000; // typically 1.0
    template int(16) volume = 0x0100; // typically, full volume
    const bit(16) reserved = 0;
    const unsigned int(32)[2] reserved = 0;
    template int(32)[9] matrix = { 0x00010000,0,0,0,0x00010000,0,0,0,0x40000000 }; // Unity matrix
    bit(32)[6] pre_defined = 0;
    unsigned int(32) next_track_ID;
}
version - is an integer that specifies the version of this box (0 or 1 in this specification)
creation_time - is an integer that declares the creation time of the presentation (in seconds
since midnight, Jan. 1, 1904, in UTC time)
modification_time - is an integer that declares the most recent time the presentation was
modified (in seconds since midnight, Jan. 1, 1904, in UTC time)
timescale - is an integer that specifies the time-scale for the entire presentation; this is the
number of time units that pass in one second. For example, a time coordinate system that
measures time in sixtieths of a second has a time scale of 60.
duration - is an integer that declares length of the presentation (in the indicated timescale). This
property is derived from the presentation’s tracks: the value of this field corresponds to the
duration of the longest track in the presentation. If the duration cannot be determined then
duration is set to all 1s.
rate - is a fixed point 16.16 number that indicates the preferred rate to play the presentation; 1.0
(0x00010000) is normal forward playback
volume - is a fixed point 8.8 number that indicates the preferred playback volume. 1.0 (0x0100) is
full volume.
matrix - provides a transformation matrix for the video; (u,v,w) are restricted here to (0,0,1), hex
values (0,0,0x40000000).
next_track_ID - is a non-zero integer that indicates a value to use for the track ID of the next
track to be added to this presentation. Zero is not a valid track ID value. The value of
next_track_ID shall be larger than the largest track-ID in use. If this value is equal to all 1s
(32-bit maxint), and a new media track is to be added, then a search must be made in the file for
an unused track identifier.
 */
class MovieHeaderBox extends FullBox {
  constructor (buffer) {
    super(buffer)

    if (this.version === 1) {
      let timeStamp = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
      this.creation_time = new Date((-2082844800 + timeStamp) * 1000) // -2082844800 is equivalent to: 01/01/1904 @ 12:00am (UTC)

      timeStamp = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
      this.modification_time = new Date((-2082844800 + timeStamp) * 1000)

      this.timescale = buffer.readUInt32BE(this._offset)
      this._offset += 4

      this.duration = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
    } else {
      let timeStamp = buffer.readUInt32BE(this._offset)
      this._offset += 4
      this.creation_time = new Date((-2082844800 + timeStamp) * 1000) // -2082844800 is equivalent to: 01/01/1904 @ 12:00am (UTC)

      timeStamp = buffer.readUInt32BE(this._offset)
      this._offset += 4
      this.modification_time = new Date((-2082844800 + timeStamp) * 1000) // -2082844800 is equivalent to: 01/01/1904 @ 12:00am (UTC)

      this.timescale = buffer.readUInt32BE(this._offset)
      this._offset += 4

      this.duration = buffer.readUInt32BE(this._offset)
      this._offset += 4
    }

    this.rate = buffer.readUInt16BE(this._offset) +
      (buffer.readUInt16BE(this._offset + 2) / 0xffff)
    this._offset += 4

    this.volume = buffer.readUInt8(this._offset) +
      buffer.readUInt8(this._offset + 1) / 0xff
    this._offset += 2

    this.reserved_1 = buffer.readUInt16BE(this._offset)
    this._offset += 2

    this.reserved_2 = []
    this.reserved_2[0] = buffer.readUInt32BE(this._offset)
    this.reserved_2[1] = buffer.readUInt32BE(this._offset + 4)
    this._offset += 8

    // TODO: check matrix encoding. 32-bit floating point?
    this.matrix = []
    for (let i = 0; i < 9; i++) {
      this.matrix[i] = buffer.readUInt32BE(this._offset)
      this._offset += 4
    }

    this.pre_defined = []
    for (let i = 0; i < 6; i++) {
      this.pre_defined[i] = buffer.readUInt32BE(this._offset)
      this._offset += 4
    }

    this.next_track_ID = buffer.readUInt32BE(this._offset)
    this._offset += 4
  }
}

/*
aligned(8) class TrackBox extends Box(‘trak’) {
}
 */
class TrackBox extends Box {
}

/*
aligned(8) class MovieExtendsBox extends Box(‘mvex’){
}
 */
class MovieExtendsBox extends Box {
}

/*
aligned(8) class UserDataBox extends Box(‘udta’) {
}
 */
class UserDataBox extends Box {
}

/*
aligned(8) class MovieFragmentHeaderBox
    extends FullBox(‘mfhd’, 0, 0){
    unsigned int(32) sequence_number;
}
 */
class MovieFragmentHeaderBox extends FullBox {
  constructor (buffer) {
    super(buffer)

    this.sequence_number = buffer.readUInt32BE(this._offset)
    this._offset += 4
  }
}

/*
aligned(8) class TrackFragmentBox extends Box(‘traf’){
}
 */
class TrackFragmentBox extends Box {
}

/*
aligned(8) class TrackHeaderBox extends FullBox(‘tkhd’, version, flags){
    if (version==1) {
        unsigned int(64) creation_time;
        unsigned int(64) modification_time;
        unsigned int(32) track_ID;
        const unsigned int(32) reserved = 0;
        unsigned int(64) duration;
    } else { // version==0
        unsigned int(32) creation_time;
        unsigned int(32) modification_time;
        unsigned int(32) track_ID;
        const unsigned int(32) reserved = 0;
        unsigned int(32) duration;
    }
    const unsigned int(32)[2] reserved = 0;
    template int(16) layer = 0;
    template int(16) alternate_group = 0;
    template int(16) volume = {if track_is_audio 0x0100 else 0};
    const unsigned int(16) reserved = 0;
    template int(32)[9] matrix= { 0x00010000,0,0,0,0x00010000,0,0,0,0x40000000 }; // unity matrix
    unsigned int(32) width;
    unsigned int(32) height;
}

version - is an integer that specifies the version of this box (0 or 1 in this specification)
flags - is a 24-bit integer with flags; the following values are defined:
    Track_enabled: Indicates that the track is enabled. Flag value is 0x000001. A disabled track (the
    low bit is zero) is treated as if it were not present.
    Track_in_movie: Indicates that the track is used in the presentation. Flag value is 0x000002.
    Track_in_preview: Indicates that the track is used when previewing the presentation. Flag value
    is 0x000004.
    Track_size_is_aspect_ratio: Indicates that the width and height fields are not expressed in
    pixel units. The values have the same units but these units are not specified. The values are
    only an indication of the desired aspect ratio. If the aspect ratios of this track and other
    related tracks are not identical, then the respective positioning of the tracks is undefined,
    possibly defined by external contexts. Flag value is 0x000008.
creation_time - is an integer that declares the creation time of this track (in seconds since
midnight, Jan. 1, 1904, in UTC time).
modification_time - is an integer that declares the most recent time the track was modified (in
seconds since midnight, Jan. 1, 1904, in UTC time).
track_ID - is an integer that uniquely identifies this track over the entire life-time of this
presentation. Track IDs are never re-used and cannot be zero.
duration - is an integer that indicates the duration of this track (in the timescale indicated in the
Movie Header Box). The value of this field is equal to the sum of the durations of all of the track’s
edits. If there is no edit list, then the duration is the sum of the sample durations, converted into
the timescale in the Movie Header Box. If the duration of this track cannot be determined then
duration is set to all 1s.
layer - specifies the front-to-back ordering of video tracks; tracks with lower numbers are closer
to the viewer. 0 is the normal value, and -1 would be in front of track 0, and so on.
alternate_group - is an integer that specifies a group or collection of tracks. If this field is 0
there is no information on possible relations to other tracks. If this field is not 0, it should be the
same for tracks that contain alternate data for one another and different for tracks belonging to
different such groups. Only one track within an alternate group should be played or streamed at
any one time, and must be distinguishable from other tracks in the group via attributes such as
bitrate, codec, language, packet size etc. A group may have only one member.
volume - is a fixed 8.8 value specifying the track's relative audio volume. Full volume is 1.0
(0x0100) and is the normal value. Its value is irrelevant for a purely visual track. Tracks may be
composed by combining them according to their volume, and then using the overall Movie
Header Box volume setting; or more complex audio composition (e.g. MPEG-4 BIFS) may be
used.
matrix - provides a transformation matrix for the video; (u,v,w) are restricted here to (0,0,1), hex
(0,0,0x40000000).
width - and height fixed-point 16.16 values are track-dependent as follows:
For text and subtitle tracks, they may, depending on the coding format, describe the suggested
size of the rendering area. For such tracks, the value 0x0 may also be used to indicate that the
data may be rendered at any size, that no preferred size has been indicated and that the actual
size may be determined by the external context or by reusing the width and height of another
track. For those tracks, the flag track_size_is_aspect_ratio may also be used.
For non-visual tracks (e.g. audio), they should be set to zero.
For all other tracks, they specify the track's visual presentation size. These need not be the same
as the pixel dimensions of the images, which is documented in the sample description(s); all
images in the sequence are scaled to this size, before any overall transformation of the track
represented by the matrix. The pixel dimensions of the images are the default values.
 */
class TrackHeaderBox extends FullBox {
  constructor (buffer) {
    super(buffer)

    if (this.version === 1) {
      let timeStamp = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
      this.creation_time = new Date((-2082844800 + timeStamp) * 1000) // -2082844800 is equivalent to: 01/01/1904 @ 12:00am (UTC)

      timeStamp = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
      this.modification_time = new Date((-2082844800 + timeStamp) * 1000)

      this.track_ID = buffer.readUInt32BE(this._offset)
      this._offset += 4

      this.reserved1 = buffer.readUInt32BE(this._offset)
      this._offset += 4

      this.duration = buffer.readUInt32BE(this._offset) << 32 +
        buffer.readUInt32BE(this._offset + 4)
      this._offset += 8
    } else {
      let timeStamp = buffer.readUInt32BE(this._offset)
      this._offset += 4
      this.creation_time = new Date((-2082844800 + timeStamp) * 1000) // -2082844800 is equivalent to: 01/01/1904 @ 12:00am (UTC)

      timeStamp = buffer.readUInt32BE(this._offset)
      this._offset += 4
      this.modification_time = new Date((-2082844800 + timeStamp) * 1000) // -2082844800 is equivalent to: 01/01/1904 @ 12:00am (UTC)

      this.track_ID = buffer.readUInt32BE(this._offset)
      this._offset += 4

      this.reserved1 = buffer.readUInt32BE(this._offset)
      this._offset += 4

      this.duration = buffer.readUInt32BE(this._offset)
      this._offset += 4
    }

    this.reserved_2 = []
    this.reserved_2[0] = buffer.readUInt32BE(this._offset)
    this.reserved_2[1] = buffer.readUInt32BE(this._offset + 4)
    this._offset += 8

    this.layer = buffer.readInt16BE(this._offset)
    this._offset += 2

    this.alternate_group = buffer.readInt16BE(this._offset)
    this._offset += 2

    this.volume = buffer.readUInt8(this._offset) +
      buffer.readUInt8(this._offset + 1) / 0xff
    this._offset += 2

    this.reserved3 = buffer.readUInt16BE(this._offset)
    this._offset += 2

    // TODO: check matrix encoding. 32-bit floating point?
    this.matrix = []
    for (let i = 0; i < 9; i++) {
      this.matrix[i] = buffer.readUInt32BE(this._offset)
      this._offset += 4
    }

    this.width = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.height = buffer.readUInt32BE(this._offset)
    this._offset += 4
  }
}

/*
aligned(8) class MediaBox extends Box(‘mdia’) {
}
 */
class MediaBox extends Box {
}

/*
aligned(8) class TrackExtendsBox extends FullBox(‘trex’, 0, 0){
    unsigned int(32) track_ID;
    unsigned int(32) default_sample_description_index;
    unsigned int(32) default_sample_duration;
    unsigned int(32) default_sample_size;
    unsigned int(32) default_sample_flags
}

track_id - identifies the track; this shall be the track ID of a track in the Movie Box
default_ - these fields set up defaults used in the track fragments.
 */
class TrackExtendsBox extends FullBox {
  constructor (buffer) {
    super(buffer)

    this.track_ID = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.default_sample_description_index = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.default_sample_duration = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.default_sample_size = buffer.readUInt32BE(this._offset)
    this._offset += 4

    this.default_sample_flags = buffer.readUInt32BE(this._offset)
    this._offset += 4
  }
}

/*
aligned(8) class MetaBox (handler_type) extends FullBox(‘meta’, version = 0, 0) {
    HandlerBox(handler_type) theHandler;
    PrimaryItemBox primary_resource; // optional
    DataInformationBox file_locations; // optional
    ItemLocationBox item_locations; // optional
    ItemProtectionBox protections; // optional
    ItemInfoBox item_infos; // optional
    IPMPControlBox IPMP_control; // optional
    ItemReferenceBox item_refs; // optional
    ItemDataBox item_data; // optional
    Box other_boxes[]; // optional
}
 */

Box.implementations = {
  ftyp: FileTypeBox,
  moov: MovieBox,
  moof: MovieFragmentBox,
  mdat: MediaDataBox,
  mfra: MovieFragmentRandomAccessBox,
  mvhd: MovieHeaderBox,
  trak: TrackBox,
  mvex: MovieExtendsBox,
  udta: UserDataBox,
  mfhd: MovieFragmentHeaderBox,
  traf: TrackFragmentBox,
  tkhd: TrackHeaderBox,
  mdia: MediaBox,
  trex: TrackExtendsBox,
  meta: null,
  tfhd: null,
  tfdt: null,
  trun: null,
  tfra: null,
  mfro: null
}

export default {
  Box,
  FullBox,
  UnimplementedBox,
  FileTypeBox,
  MovieBox,
  MovieFragmentBox,
  MediaDataBox,
  MovieFragmentRandomAccessBox,
  MovieHeaderBox,
  TrackBox,
  MovieExtendsBox,
  UserDataBox,
  MovieFragmentHeaderBox,
  TrackFragmentBox,
  TrackHeaderBox,
  MediaBox,
  TrackExtendsBox
}
