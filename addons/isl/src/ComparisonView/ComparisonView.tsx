/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {Result} from '../types';
import type {Context, LineRangeParams} from './SplitDiffView/types';
import type {Comparison} from 'shared/Comparison';
import type {ParsedDiff} from 'shared/patch/parse';

import serverAPI from '../ClientToServerAPI';
import {EmptyState} from '../EmptyState';
import {ErrorBoundary, ErrorNotice} from '../ErrorNotice';
import {useGeneratedFileStatuses} from '../GeneratedFile';
import {Subtle} from '../Subtle';
import {Tooltip} from '../Tooltip';
import {T, t} from '../i18n';
import {atomFamilyWeak, atomLoadableWithRefresh} from '../jotaiUtils';
import platform from '../platform';
import {latestHeadCommit} from '../serverAPIState';
import {GeneratedStatus} from '../types';
import {SplitDiffView} from './SplitDiffView';
import {currentComparisonMode} from './atoms';
import {VSCodeButton, VSCodeDropdown, VSCodeOption} from '@vscode/webview-ui-toolkit/react';
import {atom, useAtom, useAtomValue, useSetAtom} from 'jotai';
import {loadable} from 'jotai/utils';
import {useEffect, useMemo, useState} from 'react';
import {comparisonIsAgainstHead, labelForComparison, ComparisonType} from 'shared/Comparison';
import {Icon} from 'shared/Icon';
import {parsePatch} from 'shared/patch/parse';
import {group, notEmpty} from 'shared/utils';

import './ComparisonView.css';

/**
 * Transform Result<T> to Result<U> by applying `fn` on result.value.
 * If the result is an error, just return it unchanged.
 */
function mapResult<T, U>(result: Result<T>, fn: (t: T) => U): Result<U> {
  return result.error == null ? {value: fn(result.value)} : result;
}

function parsePatchAndFilter(patch: string): ReturnType<typeof parsePatch> {
  const result = parsePatch(patch);
  return result.filter(
    // empty patches and other weird situations can cause invalid files to get parsed, ignore these entirely
    diff => diff.hunks.length > 0 || diff.newFileName != null || diff.oldFileName != null,
  );
}

const currentComparisonData = atomFamilyWeak((comparison: Comparison) =>
  atomLoadableWithRefresh<Result<Array<ParsedDiff>>>(async () => {
    serverAPI.postMessage({type: 'requestComparison', comparison});
    const event = await serverAPI.nextMessageMatching(
      'comparison',
      event => comparison.type === event.comparison.type,
    );
    return mapResult(event.data.diff, parsePatchAndFilter);
  }),
);

export const lineRange = atomFamilyWeak(
  (params: LineRangeParams<{path: string; comparison: Comparison}>) =>
    loadable(
      atom(async (get): Promise<Array<string>> => {
        // We must ensure this lineRange gets invalidated when the underlying file's context lines
        // have changed.
        // This depends on the comparison:
        // for Committed: the commit hash is included in the Comparison, thus the cached data will always be accurate.
        // for Uncommitted, Head, and Stack:
        // by referencing the latest head commit atom, we ensure this selector reloads when the head commit changes.
        // These comparisons are all against the working copy (not exactly head),
        // but there's no change that could be made that would affect the context lines without
        // also changing the head commit's hash.
        // Note: we use latestHeadCommit WITHOUT previews, so we don't accidentally cache the file content
        // AGAIN on the same data while waiting for some new operation to finish.
        get(latestHeadCommit);

        serverAPI.postMessage({type: 'requestComparisonContextLines', ...params});

        const result = await serverAPI.nextMessageMatching('comparisonContextLines', () => true);
        return result.lines;
      }),
    ),
);

export default function ComparisonView({comparison}: {comparison: Comparison}) {
  const compared = useAtomValue(currentComparisonData(comparison));

  const data = compared.state === 'hasData' ? compared.data : null;

  const paths = useMemo(
    () => data?.value?.map(file => file.newFileName).filter(notEmpty) ?? [],
    [data?.value],
  );
  const generatedStatuses = useGeneratedFileStatuses(paths);
  const [collapsedFiles, setCollapsedFile] = useCollapsedFilesState({
    isLoading: compared.state === 'loading',
    data,
  });

  let content;
  if (data == null) {
    content = <Icon icon="loading" />;
  } else if (compared.state === 'hasError') {
    const error = compared.error instanceof Error ? compared.error : new Error(`${compared.error}`);
    content = <ErrorNotice error={error} title={t('Unable to load comparison')} />;
  } else if (data?.value && data.value.length === 0) {
    content =
      comparison.type === ComparisonType.SinceLastCodeReviewSubmit ? (
        <EmptyState>
          <T>No Content Changes</T>
          <br />
          <Subtle>
            <T> This commit might have been rebased</T>
          </Subtle>
        </EmptyState>
      ) : (
        <EmptyState>
          <T>No Changes</T>
        </EmptyState>
      );
  } else {
    const files = data.value ?? [];
    const fileGroups = group(files, file => generatedStatuses[file.newFileName ?? '']);
    content = (
      <>
        {fileGroups[GeneratedStatus.Manual]?.map((parsed, i) => (
          <ComparisonViewFile
            diff={parsed}
            comparison={comparison}
            key={i}
            collapsed={collapsedFiles.get(parsed.newFileName ?? '') ?? false}
            setCollapsed={(collapsed: boolean) =>
              setCollapsedFile(parsed.newFileName ?? '', collapsed)
            }
            generatedStatus={GeneratedStatus.Manual}
          />
        ))}
        {fileGroups[GeneratedStatus.PartiallyGenerated]?.map((parsed, i) => (
          <ComparisonViewFile
            diff={parsed}
            comparison={comparison}
            key={i}
            collapsed={collapsedFiles.get(parsed.newFileName ?? '') ?? false}
            setCollapsed={(collapsed: boolean) =>
              setCollapsedFile(parsed.newFileName ?? '', collapsed)
            }
            generatedStatus={GeneratedStatus.PartiallyGenerated}
          />
        ))}
        {fileGroups[GeneratedStatus.Generated]?.map((parsed, i) => (
          <ComparisonViewFile
            diff={parsed}
            comparison={comparison}
            key={i}
            collapsed={collapsedFiles.get(parsed.newFileName ?? '') ?? false}
            setCollapsed={(collapsed: boolean) =>
              setCollapsedFile(parsed.newFileName ?? '', collapsed)
            }
            generatedStatus={GeneratedStatus.Generated}
          />
        ))}
      </>
    );
  }

  return (
    <div data-testid="comparison-view" className="comparison-view">
      <ComparisonViewHeader
        comparison={comparison}
        collapsedFiles={collapsedFiles}
        setCollapsedFile={setCollapsedFile}
      />
      <div className="comparison-view-details">{content}</div>
    </div>
  );
}

const defaultComparisons = [
  ComparisonType.UncommittedChanges as const,
  ComparisonType.HeadChanges as const,
  ComparisonType.StackChanges as const,
];
function ComparisonViewHeader({
  comparison,
  collapsedFiles,
  setCollapsedFile,
}: {
  comparison: Comparison;
  collapsedFiles: Map<string, boolean>;
  setCollapsedFile: (path: string, collapsed: boolean) => unknown;
}) {
  const setComparisonMode = useSetAtom(currentComparisonMode);
  const [compared, reloadComparison] = useAtom(currentComparisonData(comparison));

  const data = compared.state === 'hasData' ? compared.data : null;

  const allFilesExpanded =
    data?.value?.every(
      file => file.newFileName && collapsedFiles.get(file.newFileName) === false,
    ) === true;
  const noFilesExpanded =
    data?.value?.every(
      file => file.newFileName && collapsedFiles.get(file.newFileName) === true,
    ) === true;
  const isLoading = compared.state === 'loading';

  return (
    <>
      <div className="comparison-view-header">
        <span className="comparison-view-header-group">
          <VSCodeDropdown
            data-testid="comparison-view-picker"
            value={comparison.type}
            onChange={event =>
              setComparisonMode(previous => ({
                ...previous,
                comparison: {
                  type: (event as React.FormEvent<HTMLSelectElement>).currentTarget
                    .value as (typeof defaultComparisons)[0],
                },
              }))
            }>
            {defaultComparisons.map(comparison => (
              <VSCodeOption value={comparison} key={comparison}>
                <T>{labelForComparison({type: comparison})}</T>
              </VSCodeOption>
            ))}
            {!defaultComparisons.includes(comparison.type as (typeof defaultComparisons)[0]) ? (
              <VSCodeOption value={comparison.type} key={comparison.type}>
                <T>{labelForComparison(comparison)}</T>
              </VSCodeOption>
            ) : null}
          </VSCodeDropdown>
          <Tooltip
            delayMs={1000}
            title={t('Reload this comparison. Comparisons do not refresh automatically.')}>
            <VSCodeButton appearance="secondary" onClick={reloadComparison}>
              <Icon icon="refresh" data-testid="comparison-refresh-button" />
            </VSCodeButton>
          </Tooltip>
          <VSCodeButton
            onClick={() => {
              for (const file of data?.value ?? []) {
                if (file.newFileName) {
                  setCollapsedFile(file.newFileName, false);
                }
              }
            }}
            disabled={isLoading || allFilesExpanded}
            appearance="icon">
            <Icon icon="unfold" slot="start" />
            <T>Expand all files</T>
          </VSCodeButton>
          <VSCodeButton
            onClick={() => {
              for (const file of data?.value ?? []) {
                if (file.newFileName) {
                  setCollapsedFile(file.newFileName, true);
                }
              }
            }}
            appearance="icon"
            disabled={isLoading || noFilesExpanded}>
            <Icon icon="fold" slot="start" />
            <T>Collapse all files</T>
          </VSCodeButton>
          {isLoading ? <Icon icon="loading" data-testid="comparison-loading" /> : null}
        </span>
        <VSCodeButton
          data-testid="close-comparison-view-button"
          appearance="icon"
          onClick={() => setComparisonMode(previous => ({...previous, visible: false}))}>
          <Icon icon="x" />
        </VSCodeButton>
      </div>
    </>
  );
}

/**
 * Derive from the parsed diff state which files should be expanded or collapsed by default.
 * This state is the source of truth of which files are expanded/collapsed.
 * This is a hook instead of a recoil selector since it depends on the comparison
 * which is a prop.
 */
function useCollapsedFilesState(data: {
  isLoading: boolean;
  data: Result<Array<ParsedDiff>> | null;
}): [Map<string, boolean>, (path: string, collapsed: boolean) => void] {
  const [collapsedFiles, setCollapsedFiles] = useState(new Map());

  useEffect(() => {
    if (data.isLoading || data.data?.value == null) {
      return;
    }

    const newCollapsedFiles = new Map(collapsedFiles);

    // Allocate a number of changed lines we're willing to show expanded by default,
    // add files until we just cross that threshold.
    // This means a single very large file will start expanded already.
    const TOTAL_DEFAULT_EXPANDED_SIZE = 4000;
    let accumulatedSize = 0;
    let indexToStartCollapsing = Infinity;
    for (const [i, diff] of data.data.value.entries()) {
      const sizeThisFile = diff.hunks.reduce((last, hunk) => last + hunk.lines.length, 0);
      accumulatedSize += sizeThisFile;
      if (accumulatedSize > TOTAL_DEFAULT_EXPANDED_SIZE) {
        indexToStartCollapsing = i;
        break;
      }
    }

    let anyChanged = false;
    for (const [i, diff] of data.data.value.entries()) {
      if (!newCollapsedFiles.has(diff.newFileName)) {
        newCollapsedFiles.set(diff.newFileName, i > 0 && i >= indexToStartCollapsing);
        anyChanged = true;
      }
      // Leave existing files alone in case the user changed their expanded state.
    }
    if (anyChanged) {
      setCollapsedFiles(newCollapsedFiles);
      // We don't bother removing files that no longer appear in the list of files.
      // That's not a big deal, this state is local to this instance of the comparison view anyway.
    }
  }, [data, collapsedFiles]);

  const setCollapsed = (path: string, collapsed: boolean) => {
    setCollapsedFiles(prev => {
      const map = new Map(prev);
      map.set(path, collapsed);
      return map;
    });
  };

  return [collapsedFiles, setCollapsed];
}

function ComparisonViewFile({
  diff,
  comparison,
  collapsed,
  setCollapsed,
  generatedStatus,
}: {
  diff: ParsedDiff;
  comparison: Comparison;
  collapsed: boolean;
  setCollapsed: (isCollapsed: boolean) => void;
  generatedStatus: GeneratedStatus;
}) {
  const path = diff.newFileName ?? diff.oldFileName ?? '';
  const context: Context = {
    id: {path, comparison},
    translate: t,
    copy: platform.clipboardCopy,
    openFile: () => platform.openFile(path),
    // only offer clickable line numbers for comparisons against head, otherwise line numbers will be inaccurate
    openFileToLine: comparisonIsAgainstHead(comparison)
      ? (line: number) => platform.openFile(path, {line})
      : undefined,
    collapsed,
    setCollapsed,
  };
  return (
    <div className="comparison-view-file" key={path}>
      <ErrorBoundary>
        <SplitDiffView ctx={context} patch={diff} path={path} generatedStatus={generatedStatus} />
      </ErrorBoundary>
    </div>
  );
}
