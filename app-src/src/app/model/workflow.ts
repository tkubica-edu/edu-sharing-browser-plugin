// The repository's editorial workflow, as the statuses a node's workflow history is written with
// (see RepositoryNodeService.addWorkflowStatus). The panel only ever writes one of them so far —
// the whole vocabulary is here because a status is meaningless without the ladder it sits on: the
// numbers are the order of the steps, and the 2xx entries undo their 1xx counterparts.

export enum WorkflowStatus {
  /**
   * The handover: the content is passed to the editorial queue to be checked. Outside the numbered
   * ladder below — it occurs in live data but is not one of the repository config's workflow states
   * — and it is what the metadata agent's `start_review_workflow` writes, so the panel's two routes
   * hand a content over under the same status.
   */
  TO_CHECK = '200_tocheck',

  METADATA_RECORD_REQUESTED = '110_METADATA_RECORD_REQUESTED',
  METADATA_QUALITY_CONFIRMED = '120_METADATA_QUALITY_CONFIRMED',
  METADATA_QUALITY_FOR_BUFFET = '125_METADATA_QUALITY_FOR_BUFFET',
  ELEMENT_REJECTED = '130_ELEMENT_REJECTED',
  ELEMENT_LEGALLY_APPROVED = '140_ELEMENT_LEGALLY_APPROVED',
  ELEMENT_APPROVED_FOR_BUFFET = '145_ELEMENT_APPROVED_FOR_BUFFET',
  PUBLISH_IN_SEARCH = '150_PUBLISH_IN_SEARCH',
  ELEMENT_UNLOCK_BUFFET = '155_ELEMENT_UNLOCK_BUFFET',
  REMOVE_FROM_SEARCH = '160_REMOVE_FROM_SEARCH',
  CRAWLER_PUBLISH_IN_SEARCH = '170_CRAWLER_PUBLISH_IN_SEARCH',

  METADATA_RECORD_REQUESTED_REVERT = '210_METADATA_RECORD_REQUESTED_REVERT',
  METADATA_QUALITY_CONFIRMED_REVERT = '220_METADATA_QUALITY_CONFIRMED_REVERT',
  METADATA_QUALITY_FOR_BUFFET_REVERT = '225_METADATA_QUALITY_FOR_BUFFET_REVERT',
  ELEMENT_LEGALLY_APPROVED_REVERT = '240_ELEMENT_LEGALLY_APPROVED_REVERT',
  ELEMENT_APPROVED_FOR_BUFFET_REVERT = '245_ELEMENT_APPROVED_FOR_BUFFET_REVERT',
  ELEMENT_UNLOCK_BUFFET_REVERT = '255_ELEMENT_UNLOCK_BUFFET_REVERT',
  CRAWLER_PUBLISH_IN_SEARCH_REVERT = '270_CRAWLER_PUBLISH_IN_SEARCH_REVERT'
}

/**
 * The queue {@link WorkflowStatus.TO_CHECK} addresses — the WLO upload management, which is who
 * checks a content submitted from here. The same authority the metadata agent hands over to
 * (`DEFAULT_WORKFLOW_RECEIVER`), so a content reaches the same desk along either route.
 *
 * A WLO group, so it is only addressed where the panel is a WLO one (see
 * `BrowserExtensionCustomWebComponentService`): elsewhere the status is recorded without a receiver
 * rather than addressed to a group that repository does not have.
 */
export const REVIEW_RECEIVER = ['GROUP_ORG_WLO-Uploadmanager'] as const;
