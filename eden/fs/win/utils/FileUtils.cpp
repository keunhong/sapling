/*
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This software may be used and distributed according to the terms of the
 * GNU General Public License version 2.
 */

#include "eden/fs/utils/FileUtils.h"
#include <folly/Format.h>
#include <folly/Utility.h>
#include <openssl/sha.h>
#include <filesystem>
#include <iostream>
#include "eden/fs/model/Hash.h"
#include "eden/fs/utils/PathFuncs.h"
#include "eden/fs/win/utils/StringConv.h"
#include "eden/fs/win/utils/WinError.h"

using folly::ByteRange;
using folly::sformat;

namespace facebook {
namespace eden {

DWORD readFile(HANDLE handle, void* buffer, size_t bytesToRead) {
  DWORD bytesRead = 0;
  // According to MSDN, ReadFile for FS will not return until it has read all
  // the requested bytes or reached EOF. So we don't need to read it in a loop.

  if (!ReadFile(
          handle, buffer, folly::to_narrow(bytesToRead), &bytesRead, nullptr)) {
    DWORD error = GetLastError();
    XLOGF(
        ERR,
        "Error while reading : bytesRead {}, Error: {} : {}",
        bytesRead,
        error,
        win32ErrorToString(error));

    throw makeWin32ErrorExplicit(error, "Error while reading");
  }
  return bytesRead;
}

static size_t
writeFile(HANDLE handle, const void* buffer, size_t bytesToWrite) {
  DWORD bytesWritten = 0;
  // According to MSDN, WriteFile for FS will not return until it has written
  // all the requested bytes. So we don't need to write it in a loop.

  if (!WriteFile(
          handle,
          buffer,
          folly::to_narrow(bytesToWrite),
          &bytesWritten,
          nullptr)) {
    DWORD error = GetLastError();
    XLOGF(
        ERR,
        "Error while writing: bytesWritten {}, {} : {}",
        bytesWritten,
        error,
        win32ErrorToString(error));

    throw makeWin32ErrorExplicit(error, "Error while writing");
  }

  return bytesWritten;
}

void writeFile(const void* buffer, size_t size, const wchar_t* filePath) {
  if (size == 0) {
    return;
  }

  FileHandle fileHandle{CreateFile(
      filePath,
      GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr,
      CREATE_ALWAYS,
      FILE_ATTRIBUTE_NORMAL,
      nullptr)};

  if (!fileHandle) {
    throw makeWin32ErrorExplicit(
        GetLastError(),
        folly::sformat(
            "Unable to create the file {}", wideToMultibyteString(filePath)));
  }

  size_t bytesWritten = writeFile(fileHandle.get(), buffer, size);
  if (bytesWritten != size) {
    throw std::logic_error(folly::sformat(
        "Partial data written, size {}, written {}", size, bytesWritten));
  }
}

void writeFileAtomic(const wchar_t* filePath, const folly::ByteRange data) {
  std::filesystem::path fullPath{filePath};
  auto parent = fullPath.parent_path();
  std::wstring tmpFile(MAX_PATH, 0);

  auto retVal = GetTempFileName(parent.c_str(), L"TMP_", 0, tmpFile.data());

  if (retVal == 0) {
    throw makeWin32ErrorExplicit(
        GetLastError(),
        folly::sformat(
            "Unable to get the temp file name: {}",
            wideToMultibyteString(filePath)));
  }

  writeFile(data, tmpFile.c_str());

  if (!MoveFileEx(tmpFile.c_str(), filePath, MOVEFILE_REPLACE_EXISTING)) {
    auto error = GetLastError();
    DeleteFile(tmpFile.c_str());
    throw makeWin32ErrorExplicit(
        error,
        folly::sformat(
            "Unable to move the file: {}", wideToMultibyteString(filePath)));
  }
}

Hash getFileSha1(AbsolutePathPiece filePath) {
  SHA_CTX ctx;
  SHA1_Init(&ctx);

  auto winPath = edenToWinPath(filePath.stringPiece());

  FileHandle fileHandle{CreateFileW(
      winPath.c_str(),
      GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      nullptr,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      nullptr)};

  while (true) {
    uint8_t buf[8192];

    DWORD bytesRead;
    if (!ReadFile(fileHandle.get(), buf, sizeof(buf), &bytesRead, nullptr)) {
      throw makeWin32ErrorExplicit(
          GetLastError(),
          sformat("Error while computing SHA1 of {}", filePath));
    }

    if (bytesRead == 0) {
      break;
    }

    SHA1_Update(&ctx, buf, bytesRead);
  }

  static_assert(Hash::RAW_SIZE == SHA_DIGEST_LENGTH);
  Hash sha1;
  SHA1_Final(sha1.mutableBytes().begin(), &ctx);

  return sha1;
}

} // namespace eden
} // namespace facebook
