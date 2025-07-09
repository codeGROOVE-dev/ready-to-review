/**
 * Demo Data for GitHub PR Dashboard
 * Mock data representing a busy software engineer working on Go, Terraform, and React
 */

const DEMO_DATA = {
    user: {
        login: 'demo',
        avatar_url: 'https://github.com/identicons/demo.png',
        name: 'Demo User'
    },
    
    organizations: ['kubernetes', 'hashicorp', 'my-company', 'react-community'],
    
    pullRequests: {
        incoming: [
            {
                id: 1,
                number: 45892,
                title: 'Fix memory leak in kubelet pod lifecycle manager',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
                updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
                user: { 
                    login: 'johndoe', 
                    avatar_url: 'https://github.com/identicons/johndoe.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'demo', 
                        avatar_url: 'https://github.com/identicons/demo.png' 
                    }
                ],
                labels: [
                    { name: 'kind/bug' }, 
                    { name: 'priority/critical' },
                    { name: 'sig/node' }
                ],
                repository_url: 'https://api.github.com/repos/kubernetes/kubernetes',
                html_url: 'https://github.com/kubernetes/kubernetes/pull/45892',
                repository: {
                    full_name: 'kubernetes/kubernetes'
                },
                last_activity: {
                    type: 'commit',
                    message: 'pushed 2 commits',
                    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
                    actor: 'johndoe'
                }
            },
            {
                id: 2,
                number: 3421,
                title: 'Add support for GKE Autopilot clusters in google provider',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
                updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
                user: { 
                    login: 'sarahchen', 
                    avatar_url: 'https://github.com/identicons/sarahchen.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'tstromberg', 
                        avatar_url: 'https://github.com/identicons/tstromberg.png' 
                    },
                    { 
                        login: 'mikejones', 
                        avatar_url: 'https://github.com/identicons/mikejones.png' 
                    }
                ],
                labels: [
                    { name: 'enhancement' }, 
                    { name: 'provider/google' },
                    { name: 'size/L' }
                ],
                repository_url: 'https://api.github.com/repos/hashicorp/terraform-provider-google',
                html_url: 'https://github.com/hashicorp/terraform-provider-google/pull/3421',
                repository: {
                    full_name: 'hashicorp/terraform-provider-google'
                },
                last_activity: {
                    type: 'comment',
                    message: 'commented on design',
                    timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
                    actor: 'mikejones'
                }
            },
            {
                id: 3,
                number: 892,
                title: 'Implement retry logic for BigQuery dataset creation',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
                updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
                user: { 
                    login: 'alexkim', 
                    avatar_url: 'https://github.com/identicons/alexkim.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'demo', 
                        avatar_url: 'https://github.com/identicons/demo.png' 
                    }
                ],
                labels: [
                    { name: 'blocked on you' },
                    { name: 'bug' },
                    { name: 'terraform' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/infrastructure',
                html_url: 'https://github.com/my-company/infrastructure/pull/892',
                repository: {
                    full_name: 'my-company/infrastructure'
                },
                last_activity: {
                    type: 'test',
                    message: 'CI checks passed',
                    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                    actor: 'github-actions'
                }
            },
            {
                id: 4,
                number: 234,
                title: 'Update React Router to v6 and fix breaking changes',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
                updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
                user: { 
                    login: 'jennywu', 
                    avatar_url: 'https://github.com/identicons/jennywu.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'demo', 
                        avatar_url: 'https://github.com/identicons/demo.png' 
                    }
                ],
                labels: [
                    { name: 'dependencies' },
                    { name: 'frontend' },
                    { name: 'breaking-change' },
                    { name: 'failing tests' },
                    { name: 'merge conflict' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/frontend-app',
                html_url: 'https://github.com/my-company/frontend-app/pull/234',
                repository: {
                    full_name: 'my-company/frontend-app'
                },
                last_activity: {
                    type: 'test',
                    message: 'tests failed',
                    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
                    actor: 'github-actions'
                }
            },
            {
                id: 5,
                number: 1567,
                title: 'Add context propagation to trace spans in API gateway',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days ago
                updated_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
                user: { 
                    login: 'davidlee', 
                    avatar_url: 'https://github.com/identicons/davidlee.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'demo', 
                        avatar_url: 'https://github.com/identicons/demo.png' 
                    }
                ],
                labels: [
                    { name: 'observability' },
                    { name: 'golang' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/api-gateway',
                html_url: 'https://github.com/my-company/api-gateway/pull/1567',
                repository: {
                    full_name: 'my-company/api-gateway'
                }
            },
            {
                id: 6,
                number: 89,
                title: 'Migrate legacy GCS buckets to uniform bucket-level access',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString(), // 95 days ago
                updated_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 45 days ago
                user: { 
                    login: 'robertsmith', 
                    avatar_url: 'https://github.com/identicons/robertsmith.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'demo', 
                        avatar_url: 'https://github.com/identicons/demo.png' 
                    }
                ],
                labels: [
                    { name: 'stale' },
                    { name: 'security' },
                    { name: 'terraform' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/infrastructure',
                html_url: 'https://github.com/my-company/infrastructure/pull/89',
                repository: {
                    full_name: 'my-company/infrastructure'
                }
            }
        ],
        
        outgoing: [
            {
                id: 7,
                number: 45901,
                title: 'Add e2e tests for StatefulSet rolling updates with PVC resizing',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
                updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'kubernetes-reviewer', 
                        avatar_url: 'https://github.com/identicons/kubernetes-reviewer.png' 
                    },
                    { 
                        login: 'sig-storage-lead', 
                        avatar_url: 'https://github.com/identicons/sig-storage-lead.png' 
                    }
                ],
                labels: [
                    { name: 'sig/storage' },
                    { name: 'kind/test' },
                    { name: 'approved' },
                    { name: 'lgtm' },
                    { name: 'ready to merge' }
                ],
                repository_url: 'https://api.github.com/repos/kubernetes/kubernetes',
                html_url: 'https://github.com/kubernetes/kubernetes/pull/45901',
                repository: {
                    full_name: 'kubernetes/kubernetes'
                },
                last_activity: {
                    type: 'review',
                    message: 'approved changes',
                    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
                    actor: 'sig-storage-lead'
                }
            },
            {
                id: 8,
                number: 3456,
                title: 'Fix Cloud SQL instance backup configuration drift detection',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
                updated_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'terraform-gcp-reviewer', 
                        avatar_url: 'https://github.com/identicons/terraform-gcp-reviewer.png' 
                    }
                ],
                labels: [
                    { name: 'bug' },
                    { name: 'provider/google' },
                    { name: 'resource/sql' },
                    { name: 'waiting-response' },
                    { name: 'failing' }
                ],
                repository_url: 'https://api.github.com/repos/hashicorp/terraform-provider-google',
                html_url: 'https://github.com/hashicorp/terraform-provider-google/pull/3456',
                repository: {
                    full_name: 'hashicorp/terraform-provider-google'
                },
                last_activity: {
                    type: 'test',
                    message: 'integration tests failed',
                    timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
                    actor: 'github-actions'
                }
            },
            {
                id: 9,
                number: 412,
                title: 'Implement memoization for expensive dashboard calculations',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
                updated_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'frontend-lead', 
                        avatar_url: 'https://github.com/identicons/frontend-lead.png' 
                    }
                ],
                labels: [
                    { name: 'performance' },
                    { name: 'react' },
                    { name: 'ready-to-merge' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/frontend-app',
                html_url: 'https://github.com/my-company/frontend-app/pull/412',
                repository: {
                    full_name: 'my-company/frontend-app'
                }
            },
            {
                id: 10,
                number: 1789,
                title: 'Add distributed tracing support for gRPC microservices',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(), // 21 days ago
                updated_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'platform-team', 
                        avatar_url: 'https://github.com/identicons/platform-team.png' 
                    },
                    { 
                        login: 'sre-lead', 
                        avatar_url: 'https://github.com/identicons/sre-lead.png' 
                    }
                ],
                labels: [
                    { name: 'enhancement' },
                    { name: 'golang' },
                    { name: 'observability' },
                    { name: 'needs-rebase' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/microservices',
                html_url: 'https://github.com/my-company/microservices/pull/1789',
                repository: {
                    full_name: 'my-company/microservices'
                }
            },
            {
                id: 11,
                number: 567,
                title: 'Refactor Terraform modules for GKE cluster provisioning',
                state: 'open',
                draft: false,
                created_at: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(), // 28 days ago
                updated_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [
                    { 
                        login: 'infrastructure-team', 
                        avatar_url: 'https://github.com/identicons/infrastructure-team.png' 
                    }
                ],
                labels: [
                    { name: 'refactor' },
                    { name: 'terraform' },
                    { name: 'gcp' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/infrastructure',
                html_url: 'https://github.com/my-company/infrastructure/pull/567',
                repository: {
                    full_name: 'my-company/infrastructure'
                }
            }
        ],
        
        drafts: [
            {
                id: 12,
                number: 2134,
                title: '[WIP] Implement connection pooling for Firestore client',
                state: 'open',
                draft: true,
                created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
                updated_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [],
                labels: [
                    { name: 'draft' },
                    { name: 'golang' },
                    { name: 'performance' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/api-gateway',
                html_url: 'https://github.com/my-company/api-gateway/pull/2134',
                repository: {
                    full_name: 'my-company/api-gateway'
                }
            },
            {
                id: 13,
                number: 678,
                title: '[Draft] Add support for Workload Identity Federation in Terraform',
                state: 'open',
                draft: true,
                created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
                updated_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
                user: { 
                    login: 'demo', 
                    avatar_url: 'https://github.com/identicons/demo.png' 
                },
                requested_reviewers: [],
                labels: [
                    { name: 'draft' },
                    { name: 'security' },
                    { name: 'terraform' },
                    { name: 'gcp' }
                ],
                repository_url: 'https://api.github.com/repos/my-company/infrastructure',
                html_url: 'https://github.com/my-company/infrastructure/pull/678',
                repository: {
                    full_name: 'my-company/infrastructure'
                }
            }
        ]
    }
};