/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This software may be used and distributed according to the terms of the
 * GNU General Public License version 2.
 */

use cmdutil::define_flags;

commands! {
    mod args;
    mod currentexe;
    mod dumpinternalconfig;
    mod dumpindexedlog;
    mod dumptrace;
    mod refreshconfig;
    mod fsync;
    mod http;
    mod mergestate;
    mod metrics;
    mod networkdoctor;
    mod structuredprogress;
    mod python;
    mod racyoutput;
    mod revsets;
    mod runlog;
    mod scmstore;
    mod scmstorereplay;
    mod segmentclone;
    mod segmentgraph;
    mod segmentpull;
    mod store;
    mod top;
    mod wait;
}

define_flags! {
    pub struct DebugArgsOpts {
        #[args]
        args: Vec<String>,
    }
}
