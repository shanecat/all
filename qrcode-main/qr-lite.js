(function () {
  const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134];
  const ECC_CODEWORDS = [0, 7, 10, 15, 20, 26];
  const DATA_CODEWORDS = [0, 19, 34, 55, 80, 108];
  const ALIGNMENT_POSITIONS = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
  };
  const PAD_BYTES = [0xec, 0x11];

  function toCanvas(canvas, text, options = {}) {
    const qr = encodeText(String(text));
    drawCanvas(canvas, qr.modules, options);
  }

  function encodeText(text) {
    const bytes = new TextEncoder().encode(text);
    const version = chooseVersion(bytes.length);
    const dataCodewords = makeDataCodewords(bytes, version);
    const codewords = addErrorCorrection(dataCodewords, version);
    const matrix = makeBaseMatrix(version);
    const mask = chooseBestMask(matrix, codewords);
    placeData(matrix, codewords, mask);
    drawFormatBits(matrix, mask);

    return {
      size: matrix.size,
      modules: matrix.modules,
    };
  }

  function chooseVersion(byteLength) {
    for (let version = 1; version <= 5; version += 1) {
      const bitLength = 4 + 8 + byteLength * 8;
      if (Math.ceil((bitLength + 4) / 8) <= DATA_CODEWORDS[version]) {
        return version;
      }
    }

    throw new Error("Code is too long for this local QR generator.");
  }

  function makeDataCodewords(bytes, version) {
    const bits = [];
    appendBits(bits, 0x4, 4);
    appendBits(bits, bytes.length, 8);

    for (const byte of bytes) {
      appendBits(bits, byte, 8);
    }

    const capacityBits = DATA_CODEWORDS[version] * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));

    while (bits.length % 8 !== 0) {
      bits.push(0);
    }

    const data = [];
    for (let index = 0; index < bits.length; index += 8) {
      data.push(bitsToByte(bits.slice(index, index + 8)));
    }

    let padIndex = 0;
    while (data.length < DATA_CODEWORDS[version]) {
      data.push(PAD_BYTES[padIndex % 2]);
      padIndex += 1;
    }

    return data;
  }

  function addErrorCorrection(data, version) {
    const eccCount = ECC_CODEWORDS[version];
    const generator = reedSolomonGenerator(eccCount);
    const remainder = reedSolomonRemainder(data, generator, eccCount);
    const allCodewords = data.concat(remainder);

    if (allCodewords.length !== TOTAL_CODEWORDS[version]) {
      throw new Error("Unexpected QR codeword count.");
    }

    return allCodewords;
  }

  function makeBaseMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => Array(size).fill(false));
    const matrix = { size, modules, reserved };

    drawFinder(matrix, 0, 0);
    drawFinder(matrix, size - 7, 0);
    drawFinder(matrix, 0, size - 7);
    drawTiming(matrix);
    drawAlignment(matrix, version);
    reserveFormatAreas(matrix);
    setFunctionModule(matrix, 8, size - 8, true);

    return matrix;
  }

  function drawFinder(matrix, left, top) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const xx = left + x;
        const yy = top + y;
        if (!isInside(matrix, xx, yy)) {
          continue;
        }

        const inPattern = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        const black =
          inPattern && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
        setFunctionModule(matrix, xx, yy, black);
      }
    }
  }

  function drawTiming(matrix) {
    for (let index = 8; index < matrix.size - 8; index += 1) {
      const black = index % 2 === 0;
      setFunctionModule(matrix, index, 6, black);
      setFunctionModule(matrix, 6, index, black);
    }
  }

  function drawAlignment(matrix, version) {
    for (const y of ALIGNMENT_POSITIONS[version]) {
      for (const x of ALIGNMENT_POSITIONS[version]) {
        const overlapsFinder =
          (x === 6 && y === 6) || (x === 6 && y === matrix.size - 7) || (x === matrix.size - 7 && y === 6);
        if (!overlapsFinder) {
          drawAlignmentPattern(matrix, x, y);
        }
      }
    }
  }

  function drawAlignmentPattern(matrix, centerX, centerY) {
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        const black = Math.max(Math.abs(x), Math.abs(y)) !== 1;
        setFunctionModule(matrix, centerX + x, centerY + y, black);
      }
    }
  }

  function reserveFormatAreas(matrix) {
    for (let i = 0; i <= 8; i += 1) {
      if (i !== 6) {
        reserve(matrix, 8, i);
        reserve(matrix, i, 8);
      }
    }

    for (let i = 0; i < 8; i += 1) {
      reserve(matrix, matrix.size - 1 - i, 8);
      reserve(matrix, 8, matrix.size - 1 - i);
    }
  }

  function chooseBestMask(baseMatrix, codewords) {
    let bestMask = 0;
    let bestPenalty = Infinity;

    for (let mask = 0; mask < 8; mask += 1) {
      const clone = cloneMatrix(baseMatrix);
      placeData(clone, codewords, mask);
      drawFormatBits(clone, mask);
      const penalty = getPenalty(clone.modules);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
      }
    }

    return bestMask;
  }

  function placeData(matrix, codewords, mask) {
    const bits = [];
    for (const codeword of codewords) {
      appendBits(bits, codeword, 8);
    }

    let bitIndex = 0;
    let upward = true;

    for (let right = matrix.size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right -= 1;
      }

      for (let vertical = 0; vertical < matrix.size; vertical += 1) {
        const y = upward ? matrix.size - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset += 1) {
          const x = right - offset;
          if (matrix.reserved[y][x]) {
            continue;
          }

          const bit = bitIndex < bits.length ? bits[bitIndex] === 1 : false;
          matrix.modules[y][x] = bit !== maskBit(mask, x, y);
          bitIndex += 1;
        }
      }

      upward = !upward;
    }
  }

  function drawFormatBits(matrix, mask) {
    const errorCorrectionLevel = 1;
    const data = (errorCorrectionLevel << 3) | mask;
    let bits = data << 10;

    for (let i = 14; i >= 10; i -= 1) {
      if (((bits >>> i) & 1) !== 0) {
        bits ^= 0x537 << (i - 10);
      }
    }

    bits = ((data << 10) | bits) ^ 0x5412;

    for (let i = 0; i <= 5; i += 1) {
      setFunctionModule(matrix, 8, i, getBit(bits, i));
    }
    setFunctionModule(matrix, 8, 7, getBit(bits, 6));
    setFunctionModule(matrix, 8, 8, getBit(bits, 7));
    setFunctionModule(matrix, 7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i += 1) {
      setFunctionModule(matrix, 14 - i, 8, getBit(bits, i));
    }

    for (let i = 0; i < 8; i += 1) {
      setFunctionModule(matrix, matrix.size - 1 - i, 8, getBit(bits, i));
    }
    for (let i = 8; i < 15; i += 1) {
      setFunctionModule(matrix, 8, matrix.size - 15 + i, getBit(bits, i));
    }

    setFunctionModule(matrix, 8, matrix.size - 8, true);
  }

  function getPenalty(modules) {
    const size = modules.length;
    let penalty = 0;

    for (let y = 0; y < size; y += 1) {
      penalty += linePenalty(modules[y]);
    }
    for (let x = 0; x < size; x += 1) {
      penalty += linePenalty(modules.map((row) => row[x]));
    }

    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const color = modules[y][x];
        if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) {
          penalty += 3;
        }
      }
    }

    const finderLike = [true, false, true, true, true, false, true, false, false, false, false];
    for (let y = 0; y < size; y += 1) {
      penalty += finderPenalty(modules[y], finderLike);
    }
    for (let x = 0; x < size; x += 1) {
      penalty += finderPenalty(
        modules.map((row) => row[x]),
        finderLike,
      );
    }

    const dark = modules.flat().filter(Boolean).length;
    const percent = (dark * 100) / (size * size);
    penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return penalty;
  }

  function linePenalty(line) {
    let penalty = 0;
    let runColor = line[0];
    let runLength = 1;

    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) {
          penalty += runLength - 2;
        }
        runColor = line[i];
        runLength = 1;
      }
    }

    if (runLength >= 5) {
      penalty += runLength - 2;
    }

    return penalty;
  }

  function finderPenalty(line, pattern) {
    let penalty = 0;
    for (let i = 0; i <= line.length - pattern.length; i += 1) {
      if (pattern.every((value, offset) => line[i + offset] === value)) {
        penalty += 40;
      }
      if (pattern.every((value, offset) => line[i + offset] === pattern[pattern.length - 1 - offset])) {
        penalty += 40;
      }
    }
    return penalty;
  }

  function drawCanvas(canvas, modules, options) {
    const margin = options.margin ?? 4;
    const width = options.width ?? 420;
    const dark = options.color?.dark ?? "#000000";
    const light = options.color?.light ?? "#ffffff";
    const size = modules.length;
    const moduleSize = Math.floor(width / (size + margin * 2));
    const imageSize = moduleSize * (size + margin * 2);
    const offset = margin * moduleSize;
    const context = canvas.getContext("2d");

    canvas.width = imageSize;
    canvas.height = imageSize;
    context.fillStyle = light;
    context.fillRect(0, 0, imageSize, imageSize);
    context.fillStyle = dark;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (modules[y][x]) {
          context.fillRect(offset + x * moduleSize, offset + y * moduleSize, moduleSize, moduleSize);
        }
      }
    }
  }

  function reedSolomonGenerator(degree) {
    let result = [1];
    for (let i = 0; i < degree; i += 1) {
      result = polyMultiply(result, [1, gfPow(2, i)]);
    }
    return result;
  }

  function reedSolomonRemainder(data, generator, degree) {
    const result = data.concat(Array(degree).fill(0));
    for (let i = 0; i < data.length; i += 1) {
      const factor = result[i];
      if (factor === 0) {
        continue;
      }
      for (let j = 0; j < generator.length; j += 1) {
        result[i + j] ^= gfMultiply(generator[j], factor);
      }
    }
    return result.slice(result.length - degree);
  }

  function polyMultiply(left, right) {
    const result = Array(left.length + right.length - 1).fill(0);
    for (let i = 0; i < left.length; i += 1) {
      for (let j = 0; j < right.length; j += 1) {
        result[i + j] ^= gfMultiply(left[i], right[j]);
      }
    }
    return result;
  }

  function gfPow(value, exponent) {
    let result = 1;
    for (let i = 0; i < exponent; i += 1) {
      result = gfMultiply(result, value);
    }
    return result;
  }

  function gfMultiply(left, right) {
    let result = 0;
    for (let i = 0; i < 8; i += 1) {
      if ((right & 1) !== 0) {
        result ^= left;
      }
      const carry = (left & 0x80) !== 0;
      left = (left << 1) & 0xff;
      if (carry) {
        left ^= 0x1d;
      }
      right >>>= 1;
    }
    return result;
  }

  function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >>> i) & 1);
    }
  }

  function bitsToByte(bits) {
    return bits.reduce((value, bit) => (value << 1) | bit, 0);
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0:
        return (x + y) % 2 === 0;
      case 1:
        return y % 2 === 0;
      case 2:
        return x % 3 === 0;
      case 3:
        return (x + y) % 3 === 0;
      case 4:
        return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5:
        return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6:
        return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7:
        return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default:
        return false;
    }
  }

  function setFunctionModule(matrix, x, y, black) {
    if (!isInside(matrix, x, y)) {
      return;
    }
    matrix.modules[y][x] = black;
    matrix.reserved[y][x] = true;
  }

  function reserve(matrix, x, y) {
    if (isInside(matrix, x, y)) {
      matrix.reserved[y][x] = true;
    }
  }

  function isInside(matrix, x, y) {
    return x >= 0 && y >= 0 && x < matrix.size && y < matrix.size;
  }

  function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
  }

  function cloneMatrix(matrix) {
    return {
      size: matrix.size,
      modules: matrix.modules.map((row) => row.slice()),
      reserved: matrix.reserved.map((row) => row.slice()),
    };
  }

  window.LocalQRCode = { toCanvas };
})();
