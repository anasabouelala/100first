/**
 * AutoCommentProcessor
 *
 * Headless hook that runs alongside the dashboard. It polls the extension
 * every 10s for pending auto-comment jobs, generates a comment via Gemini
 * for each, and submits the generated text back. The SW then queues the
 * comment for posting via the existing engagement queue.
 *
 * Why hybrid (web app generation, SW posting)?
 *   • The Gemini API key lives in the web app (VITE_GEMINI_API_KEY).
 *     Putting the key in extension storage would expose it to any other
 *     extension page that reads chrome.storage.local. The web app is
 *     a sealed origin — safer.
 *   • The SW handles posting via its proven stealth-window pipeline.
 *   • Limitation: auto-comment only runs while the dashboard tab is open.
 *     Documented in the settings card so the user isn't surprised.
 */
import { useEffect, useRef } from 'react';
import { generateSmartEngagementComment } from '../services/geminiService';
import { useProject } from '../contexts/ProjectContext';
import { useVoiceProfile } from '../hooks/useVoiceProfile';

interface PendingJob {
    id: string;
    url: string;
    postUrl: string;
    platform: string;
    creator: string;
    postText: string;
    tone: 'casual' | 'formal' | 'funny';
    goal: string;
    queuedAt: number;
}

export const AutoCommentProcessor: React.FC = () => {
    const { project } = useProject();
    const processingRef = useRef<Set<string>>(new Set());

    // Pull the active Voice Studio profile so background auto-replies are
    // generated in the SAME voice (trait dials + perspective) and comment
    // defaults (length budget) as the manual Posts Tracker generator — not the
    // thin tone/goal-only payload the SW job carries. Mirror it into a ref so
    // the long-lived polling closure always reads the latest values without
    // re-subscribing the interval on every keystroke in Voice Studio.
    const vp = useVoiceProfile();
    const voiceRef = useRef({ voiceMix: vp.voiceMix, perspective: vp.perspective, commentSpec: vp.commentSpec });
    voiceRef.current = { voiceMix: vp.voiceMix, perspective: vp.perspective, commentSpec: vp.commentSpec };

    useEffect(() => {
        let cancelled = false;

        const tick = async () => {
            if (cancelled) return;
            // Ask the SW for pending jobs
            const jobs = await new Promise<PendingJob[]>((resolve) => {
                const handler = (e: any) => {
                    window.removeEventListener('auto_comment_pending_loaded', handler);
                    resolve(e.detail?.jobs || []);
                };
                window.addEventListener('auto_comment_pending_loaded', handler);
                window.dispatchEvent(new CustomEvent('auto_comment_pending_get'));
                setTimeout(() => { window.removeEventListener('auto_comment_pending_loaded', handler); resolve([]); }, 5000);
            });

            // Process at most one job per tick — sequential, no concurrent API calls
            const next = jobs.find(j => !processingRef.current.has(j.id));
            if (!next) return;

            processingRef.current.add(next.id);
            try {
                const appDesc = project?.pitch || 'a SaaS product';
                const v = voiceRef.current;
                const smart = await generateSmartEngagementComment(
                    next.postText, appDesc, next.creator,
                    {
                        // Job-level overrides (tone/goal set when the job was queued)…
                        tone: next.tone, goal: next.goal, platform: next.platform,
                        // …fused with the user's Voice Studio profile so auto-replies
                        // read in the saved voice, not a generic default.
                        customInstruction: (next as any).customInstruction || v.commentSpec.customInstruction,
                        maxLength: v.commentSpec.maxLength,
                        voiceMix: v.voiceMix,
                        perspective: v.perspective,
                    }
                );
                // generateSmartEngagementComment returns { options: [{ body, why }] }
                const options = (smart as any)?.options || [];
                const pick = options.length > 0
                    ? (typeof options[0] === 'string' ? options[0] : options[0]?.body)
                    : '';
                if (!pick || pick.length < 5) {
                    console.warn('[AutoReply] Generation returned no usable text', smart);
                    window.dispatchEvent(new CustomEvent('auto_comment_dismiss', { detail: { jobId: next.id } }));
                    return;
                }
                // Human-in-the-loop: SAVE the draft for review — do not post it.
                window.dispatchEvent(new CustomEvent('auto_comment_save_draft', { detail: { jobId: next.id, comment: pick } }));
            } catch (e) {
                console.error('[AutoReply] Generation failed for', next.id, e);
                // Dismiss so we don't retry the same failing job forever
                window.dispatchEvent(new CustomEvent('auto_comment_dismiss', { detail: { jobId: next.id } }));
            } finally {
                processingRef.current.delete(next.id);
            }
        };

        // Run once on mount, then every 10s. Conservative pace — auto-comment
        // is a slow background activity, not real-time.
        tick();
        const id = setInterval(tick, 10_000);
        return () => { cancelled = true; clearInterval(id); };
    }, [project?.pitch]);

    return null; // pure side-effect component
};
