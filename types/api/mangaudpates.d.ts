// Shared types for the MangaUpdates v1 public API (https://api.mangaupdates.com/v1).
//
// These cover the read-only series endpoints — `POST /series/search` and
// `GET /series/{id}` — that the `mangaupdates` custom-source and the
// `mangaupdates-sync` plugin both consume.

declare namespace $mu {
  interface Genre {
    genre: string;
  }

  interface Image {
    url: URL;
    height: number;
    width: number;
  }

  interface URL {
    original: string;
    thumb: string;
  }

  declare namespace Login {
    interface Response {
      status: string;
      reason?: string;
      context: {
        session_token: string;
        uid: number;
      };
    }
  }

  declare namespace Search {
    interface Response {
      total_hits: number;
      page: number;
      per_page: number;
      results: Result[];
    }

    interface Result {
      record: Record;
      hit_title: string;
      metadata: Metadata;
    }

    interface Metadata {
      user_list: UserList;
      user_genre_highlights: any[];
    }

    interface UserList {
      list_type: null | string;
      list_icon: null;
      status: Status;
    }

    interface Status {
      volume: number | null;
      chapter: number | null;
    }

    interface Record {
      series_id: number;
      title: string;
      url: string;
      description: null | string;
      image: Image;
      type: string;
      year: string;
      bayesian_rating: number | null;
      rating_votes: number;
      genres: Genre[];
      last_updated: LastUpdated;
    }

    interface LastUpdated {
      timestamp: number;
      as_rfc3339: string;
      as_string: string;
    }
  }

  declare namespace Series {
    interface Response extends Search.Record {
      associated: Associated[];
      categories: Category[];
      latest_chapter: number;
      forum_id: number;
      status: string;
      licensed: boolean;
      completed: boolean;
      anime: Anime;
      related_series: RelatedSery[];
      authors: Author[];
      publishers: Publisher[];
      publications: Publication[];
      recommendations: any[];
      category_recommendations: CategoryRecommendation[];
      rank: Rank;
      admin: Admin;
    }

    interface Admin {
      approved: boolean;
    }

    interface Anime {
      start: string;
      end: string;
    }

    interface Associated {
      title: string;
    }

    interface Author {
      name: string;
      author_id: number | null;
      url: null | string;
      type: string;
    }

    interface Category {
      series_id: number;
      category: string;
      votes: number;
      votes_plus: number;
      votes_minus: number;
      added_by: number;
    }

    interface CategoryRecommendation {
      series_name: string;
      series_url: string;
      series_id: number;
      series_image: Image;
      weight: number;
    }

    interface Publication {
      publication_name: string;
      publisher_name: null;
      publisher_id: null;
    }

    interface Publisher {
      publisher_name: string;
      publisher_id: number | null;
      url: null | string;
      type: string;
      notes: null | string;
    }

    interface Rank {
      position: Position;
      old_position: Position;
      lists: Lists;
    }

    interface Lists {
      reading: number;
      wish: number;
      complete: number;
      unfinished: number;
      custom: number;
    }

    interface Position {
      week: number;
      month: number;
      three_months: number;
      six_months: number;
      year: number;
    }

    interface RelatedSery {
      relation_id: number;
      relation_type: string;
      related_series_id: number;
      related_series_name: string;
      related_series_url: string;
      triggered_by_relation_id: number;
    }
  }
}
