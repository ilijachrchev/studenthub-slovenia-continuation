jest.mock("../db", () => ({
  query: jest.fn(),
}));

const pool = require("../db");
const {
  buildRecommendationContext,
  getRecommendations,
  scoreOpportunity,
} = require("../lib/opportunity/recommendations");

describe("recommendation helpers", () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test("scores opportunities higher when they match prior organizations and topics", () => {
    const context = buildRecommendationContext(
      [
        {
          opportunity_id: 10,
          organization_id: 2,
          title: "Open Source Sprint",
          description: "Build the frontend together",
          location: "Koper",
          organization_name: "Open Source Club",
        },
      ],
      []
    );

    const highMatch = scoreOpportunity(
      {
        id: 1,
        title: "Open Source Frontend Volunteer",
        description: "Help build the frontend",
        location: "Koper",
        deadline: "2026-09-01T12:00:00Z",
        organization_id: 2,
        organization_name: "Open Source Club",
      },
      context
    );

    const lowMatch = scoreOpportunity(
      {
        id: 2,
        title: "Completely Different Topic",
        description: "No overlap with previous activity",
        location: "Ljubljana",
        deadline: "2026-11-01T12:00:00Z",
        organization_id: 99,
        organization_name: "Another Org",
      },
      context
    );

    expect(highMatch.score).toBeGreaterThan(lowMatch.score);
    expect(highMatch.reason).toBeTruthy();
  });

  test("returns an empty recommendation set when no opportunities exist", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await getRecommendations(3, 10, 1);

    expect(result.items).toEqual([]);
    expect(result.opportunities).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  test("paginates the ranked recommendation list", async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            title: "First",
            description: "One",
            location: "A",
            deadline: "2026-09-01T00:00:00Z",
            status: "published",
            organization_id: 1,
            organization_name: "Org A",
          },
          {
            id: 2,
            title: "Second",
            description: "Two",
            location: "B",
            deadline: "2026-10-01T00:00:00Z",
            status: "published",
            organization_id: 1,
            organization_name: "Org A",
          },
          {
            id: 3,
            title: "Third",
            description: "Three",
            location: "C",
            deadline: "2026-11-01T00:00:00Z",
            status: "published",
            organization_id: 1,
            organization_name: "Org A",
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const result = await getRecommendations(null, 2, 2);

    expect(result.limit).toBe(2);
    expect(result.page).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual([3]);
    expect(result.total).toBe(3);
  });
});
