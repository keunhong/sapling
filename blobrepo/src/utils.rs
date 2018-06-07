// Copyright (c) 2004-present, Facebook, Inc.
// All Rights Reserved.
//
// This software may be used and distributed according to the terms of the
// GNU General Public License version 2 or any later version.

use std::borrow::Cow;

use bytes::Bytes;
use futures::future::{Future, IntoFuture};
use futures_ext::{BoxFuture, FutureExt};

use bincode;

use blobstore::Blobstore;
use mercurial_types::{HgBlobHash, HgNodeHash, HgParents};
use mononoke_types::BlobstoreBytes;

use errors::*;

#[derive(Debug, Copy, Clone)]
#[derive(Serialize, Deserialize)]
pub struct RawNodeBlob {
    pub parents: HgParents,
    pub blob: HgBlobHash,
}

impl RawNodeBlob {
    pub fn serialize(&self, nodeid: &HgNodeHash) -> Result<EnvelopeBlob> {
        let serialized = bincode::serialize(self)
            .map_err(|err| Error::from(ErrorKind::SerializationFailed(*nodeid, err)))?;
        Ok(EnvelopeBlob(serialized.into()))
    }

    pub fn deserialize(blob: &EnvelopeBlob) -> Result<Self> {
        Ok(bincode::deserialize(blob.0.as_ref())?)
    }
}

// In stock mercurial, the revlog acts as an envelope which holds (primarily) the parents
// for each entry. The changelog itself is encoded as a blob within the entry. This structure
// replicates this for use within the blob store. In principle the cs blob and the envelope
// could be stored separately, but I think the disadvantages (more objects, more latency,
// more brittle) outweigh the advantages (potential for sharing changesets, consistency
// with file storage).
#[derive(Clone, Eq, PartialEq, Ord, PartialOrd, Debug, Hash)]
#[derive(Serialize, Deserialize, HeapSizeOf)]
pub struct RawCSBlob<'a> {
    pub parents: HgParents,
    pub blob: Cow<'a, [u8]>,
}

impl<'a> RawCSBlob<'a> {
    pub(crate) fn serialize(&self) -> Result<EnvelopeBlob> {
        let serialized = bincode::serialize(self)?;
        // XXX better error message?
        Ok(EnvelopeBlob(serialized.into()))
    }

    pub(crate) fn deserialize(blob: &EnvelopeBlob) -> Result<Self> {
        Ok(bincode::deserialize(blob.0.as_ref())?)
    }
}

// XXX could possibly also compute and store an ID here
#[derive(Debug)]
pub struct EnvelopeBlob(Bytes);

impl EnvelopeBlob {
    #[deprecated(note = "this should only be used by blobimport")]
    pub fn new<B: Into<Bytes>>(data: B) -> Self {
        EnvelopeBlob(data.into())
    }
}

impl AsRef<[u8]> for EnvelopeBlob {
    fn as_ref(&self) -> &[u8] {
        self.0.as_ref()
    }
}

impl From<BlobstoreBytes> for EnvelopeBlob {
    #[inline]
    fn from(bytes: BlobstoreBytes) -> EnvelopeBlob {
        EnvelopeBlob(bytes.into_bytes())
    }
}

impl From<EnvelopeBlob> for BlobstoreBytes {
    #[inline]
    fn from(blob: EnvelopeBlob) -> BlobstoreBytes {
        BlobstoreBytes::from_bytes(blob.0)
    }
}

pub fn get_node_key(nodeid: HgNodeHash) -> String {
    format!("node-{}.bincode", nodeid)
}

pub fn get_node(blobstore: &Blobstore, nodeid: HgNodeHash) -> BoxFuture<RawNodeBlob, Error> {
    let key = get_node_key(nodeid);

    blobstore
        .get(key)
        .and_then(move |got| got.ok_or(ErrorKind::NodeMissing(nodeid).into()))
        .and_then(move |blob| {
            let blob = EnvelopeBlob::from(blob);
            RawNodeBlob::deserialize(&blob).into_future()
        })
        .boxify()
}
