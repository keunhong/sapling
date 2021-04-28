/*
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This software may be used and distributed according to the terms of the
 * GNU General Public License version 2.
 */

use anyhow::Result;
use bytes::Bytes;
#[cfg(any(test, feature = "for-tests"))]
use quickcheck::Arbitrary;
use serde_derive::{Deserialize, Serialize};

use dag_types::Location;
use types::hgid::HgId;

use crate::ServerError;

/// Given a graph location, return `count` hashes following first parent links.
///
/// Example:
/// 0 - a - b - c
/// In this example our initial commit is `0`, then we have `a` the first commit, `b` second,
/// `c` third.
/// {
///   location: {
///     descendant: c,
///     distance: 1,
///   }
///   count: 2,
/// }
/// => [b, a]
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitLocationToHashRequest {
    pub location: Location<HgId>,
    pub count: u64,
}

#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitLocationToHashResponse {
    pub location: Location<HgId>,
    pub count: u64,
    pub hgids: Vec<HgId>,
}

#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitLocationToHashRequestBatch {
    pub requests: Vec<CommitLocationToHashRequest>,
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitLocationToHashRequest {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitLocationToHashRequest {
            location: Arbitrary::arbitrary(g),
            count: Arbitrary::arbitrary(g),
        }
    }
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitLocationToHashResponse {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitLocationToHashResponse {
            location: Arbitrary::arbitrary(g),
            count: Arbitrary::arbitrary(g),
            hgids: Arbitrary::arbitrary(g),
        }
    }
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitLocationToHashRequestBatch {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitLocationToHashRequestBatch {
            requests: Arbitrary::arbitrary(g),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitHashToLocationRequestBatch {
    pub master_heads: Vec<HgId>,
    pub hgids: Vec<HgId>,
    pub unfiltered: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[derive(Serialize)] // used to convert to Python
pub struct CommitHashToLocationResponse {
    pub hgid: HgId,
    pub result: Result<Option<Location<HgId>>, ServerError>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[derive(Serialize)]
pub struct CommitKnownResponse {
    pub hgid: HgId,
    /// `Ok(true)`: The server verified that `hgid` is known.
    /// `Ok(false)`: The server does not known `hgid`.
    /// `Err`: The server cannot check `hgid`.
    pub known: Result<bool, ServerError>,
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitHashToLocationRequestBatch {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitHashToLocationRequestBatch {
            master_heads: Arbitrary::arbitrary(g),
            hgids: Arbitrary::arbitrary(g),
            unfiltered: Arbitrary::arbitrary(g),
        }
    }
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitHashToLocationResponse {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitHashToLocationResponse {
            hgid: Arbitrary::arbitrary(g),
            result: Arbitrary::arbitrary(g),
        }
    }
}

/// The list of Mercurial commit identifiers for which we want the commit data to be returned.
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitRevlogDataRequest {
    pub hgids: Vec<HgId>,
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitRevlogDataRequest {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitRevlogDataRequest {
            hgids: Arbitrary::arbitrary(g),
        }
    }
}

/// A mercurial commit entry as it was serialized in the revlog.
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitRevlogData {
    #[serde(with = "types::serde_with::hgid::bytes")]
    pub hgid: HgId,
    pub revlog_data: Bytes,
}

impl CommitRevlogData {
    pub fn new(hgid: HgId, revlog_data: Bytes) -> Self {
        Self { hgid, revlog_data }
    }
}

/// Request commit hashes that fall in the [low..high] range.
// Note: limit is implied to be 10.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub enum CommitHashLookupRequest {
    InclusiveRange(HgId, HgId),
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitHashLookupRequest {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitHashLookupRequest::InclusiveRange(Arbitrary::arbitrary(g), Arbitrary::arbitrary(g))
    }
}

/// Commit hashes that are known to the server in the described range.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
#[derive(Serialize, Deserialize)]
pub struct CommitHashLookupResponse {
    pub request: CommitHashLookupRequest,
    pub hgids: Vec<HgId>,
}

#[cfg(any(test, feature = "for-tests"))]
impl Arbitrary for CommitHashLookupResponse {
    fn arbitrary<G: quickcheck::Gen>(g: &mut G) -> Self {
        CommitHashLookupResponse {
            request: Arbitrary::arbitrary(g),
            hgids: Arbitrary::arbitrary(g),
        }
    }
}
