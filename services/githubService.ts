import { GitHubPulse } from '../types';

/**
 * Fetches repository metadata and activity from GitHub API.
 * Supports public repos and private repos via optional Personal Access Token (PAT).
 */
export const fetchRepoPulse = async (owner: string, repo: string, token?: string, since?: string, until?: string): Promise<GitHubPulse> => {
    const headers: HeadersInit = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LaunchVelocity-App'
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

    try {
        // 1. Fetch Repo Metadata
        const repoRes = await fetch(baseUrl, { headers });
        if (!repoRes.ok) throw new Error(`Repo not found: ${owner}/${repo}`);
        const repoData = await repoRes.json();

        // 2. Fetch Languages
        const langRes = await fetch(`${baseUrl}/languages`, { headers });
        const langData = await langRes.json();
        const languages = Object.keys(langData);

        // 3. Fetch Commits (Recent Activity)
        let commitUrl = `${baseUrl}/commits?per_page=30`;
        if (since) commitUrl += `&since=${since}`;
        if (until) commitUrl += `&until=${until}`;

        const commitRes = await fetch(commitUrl, { headers });
        const commitData = await commitRes.json();
        const recentCommits = Array.isArray(commitData) 
            ? commitData.map((c: any) => `${new Date(c.commit.author.date).toLocaleDateString()}: ${c.commit.message}`) 
            : [];

        // 4. Fetch Contributors (for count)
        const contributorsRes = await fetch(`${baseUrl}/contributors?per_page=1&anon=true`, { headers });
        const contribCountMatch = contributorsRes.headers.get('link')?.match(/next.*page=(\d+)>; rel="last"/);
        const contributorCount = contribCountMatch ? parseInt(contribCountMatch[1]) : 1;

        // 5. Fetch README
        let readmeContent = "";
        try {
            const readmeRes = await fetch(`${baseUrl}/readme`, { 
                headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' } 
            });
            if (readmeRes.ok) {
                readmeContent = await readmeRes.text();
            }
        } catch (e) {
            console.warn("Could not fetch README");
        }

        // 6. Fetch File Structure (Top Level)
        let fileStructure: string[] = [];
        try {
            const contentsRes = await fetch(`${baseUrl}/contents`, { headers });
            if (contentsRes.ok) {
                const contents = await contentsRes.json();
                fileStructure = Array.isArray(contents) ? contents.map((f: any) => f.name) : [];
            }
        } catch (e) {
            console.warn("Could not fetch contents");
        }

        return {
            name: repoData.name,
            owner: repoData.owner.login,
            description: repoData.description || "No description provided.",
            stars: repoData.stargazers_count,
            forks: repoData.forks_count,
            primaryLanguage: repoData.language || "Unknown",
            allLanguages: languages,
            totalCommits: 0,
            recentCommitMessages: recentCommits,
            lastUpdate: repoData.updated_at,
            contributorCount: contributorCount,
            topTopics: repoData.topics || [],
            readmeContent: readmeContent.slice(0, 10000), // Cap for context
            fileStructure: fileStructure
        };
    } catch (error) {
        console.error("GitHub Fetch Error:", error);
        throw error;
    }
};

/**
 * Helper to parse "owner/repo" from a GitHub URL or string.
 */
export const parseGitHubUrl = (input: string): { owner: string; repo: string } | null => {
    // Format: https://github.com/owner/repo or owner/repo
    const clean = input.replace('https://github.com/', '').replace('http://github.com/', '').replace('.git', '');
    const parts = clean.split('/').filter(p => !!p);
    if (parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
    }
    return null;
};
