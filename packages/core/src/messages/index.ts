/**
 * Internal Message Bus
 *
 * This module exports all types and utilities for the internal message bus
 * that provides a unified interface for handling events from multiple
 * webhook sources (Linear, GitHub, etc.).
 *
 * @module messages
 */

// Translator interface
export type {
	IMessageTranslator,
	TranslationContext,
	TranslationResult,
} from "./IMessageTranslator.js";

// Platform reference types
export type {
	GitHubPlatformRef,
	LinearPlatformRef,
} from "./platform-refs.js";

// Type guards
export {
	hasGitHubSessionStartPlatformData,
	hasGitHubUserPromptPlatformData,
	hasLinearSessionStartPlatformData,
	hasLinearUserPromptPlatformData,
	isContentUpdateMessage,
	isGitHubMessage,
	isIssueStateChangeMessage,
	isLinearMessage,
	isSessionStartMessage,
	isStopSignalMessage,
	isUnassignMessage,
	isUserPromptMessage,
} from "./type-guards.js";
// Core message types
export type {
	ContentChanges,
	ContentUpdateMessage,
	GitHubSessionStartPlatformData,
	GitHubUserPromptPlatformData,
	GuidanceItem,
	InternalMessage,
	InternalMessageBase,
	IssueStateChangeMessage,
	LinearContentUpdatePlatformData,
	LinearIssueStateChangePlatformData,
	// Platform-specific data types
	LinearSessionStartPlatformData,
	LinearStopSignalPlatformData,
	LinearUnassignPlatformData,
	LinearUserPromptPlatformData,
	MessageAction,
	MessageAuthor,
	MessageSource,
	SessionStartMessage,
	StopSignalMessage,
	UnassignMessage,
	UserPromptMessage,
} from "./types.js";
