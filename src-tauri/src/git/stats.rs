use std::collections::HashMap;

use git2::Sort;
use serde::Serialize;

use super::open;
use crate::error::GitResult;

/// 统计最多遍历的提交数；超过后由前端提示结果已截断。
const MAX_STAT_COMMITS: usize = 100_000;
/// 月度图表最多展示的月份数，避免十年以上仓库出现上百根柱子。
const MAX_MONTHS: i64 = 24;
const DAY: i64 = 86_400;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorStat {
    /// 邮箱优先的身份键；无邮箱时用 name:<名字>，供作者筛选与头像着色。
    pub key: String,
    pub name: String,
    pub email: String,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatBucket {
    pub key: String,
    pub label: String,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub authors: Vec<AuthorStat>,
    /// 当前筛选（作者为空 = 全部）下的提交数，用于页脚 COMMITS。
    pub total_commits: u32,
    pub truncated: bool,
    pub months: Vec<StatBucket>,
    pub month_days: Vec<StatBucket>,
    pub week_days: Vec<StatBucket>,
    pub months_label: String,
    pub month_label: String,
    pub week_label: String,
}

/// 仓库提交统计：按作者聚合，并返回总览（月）/ 当月（日）/ 当周（日）三种时间桶。
/// 作者筛选只影响时间桶与总数，作者列表始终展示所选 ref 的全部作者。
pub fn get_statistics(
    path: String,
    revspec: Option<String>,
    author: Option<String>,
) -> GitResult<Statistics> {
    let repo = open(&path)?;
    let author_filter = author
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TIME)?;
    match revspec
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(spec) => {
            let commit = repo.revparse_single(spec)?.peel_to_commit()?;
            walk.push(commit.id())?;
        }
        // 与日志默认范围一致：HEAD + 全部 refs，排除内部备份与符号引用。
        None => {
            if let Ok(head) = repo.head().and_then(|head| head.peel_to_commit()) {
                walk.push(head.id())?;
            }
            for reference in repo.references()?.flatten() {
                let Some(name) = reference.name() else {
                    continue;
                };
                if name.starts_with("refs/git-extensions/backups/")
                    || name.starts_with("refs/original/")
                    || reference.symbolic_target().is_some()
                {
                    continue;
                }
                if let Ok(commit) = reference.peel_to_commit() {
                    let _ = walk.push(commit.id());
                }
            }
        }
    }

    let mut authors: HashMap<String, AuthorStat> = HashMap::new();
    let mut month_counts: HashMap<i64, u32> = HashMap::new();
    let mut day_counts: HashMap<i64, u32> = HashMap::new();
    let mut total: u32 = 0;
    let mut visited = 0usize;
    let mut truncated = false;
    let mut latest_day: Option<i64> = None;
    let mut earliest_month: Option<i64> = None;

    for item in walk {
        if visited >= MAX_STAT_COMMITS {
            truncated = true;
            break;
        }
        let Ok(oid) = item else { continue };
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };
        visited += 1;
        let signature = commit.author();
        let name = signature.name().unwrap_or_default().to_string();
        let email = signature.email().unwrap_or_default().to_string();
        let key = if email.is_empty() {
            format!("name:{name}")
        } else {
            email.clone()
        };
        authors
            .entry(key.clone())
            .or_insert_with(|| AuthorStat {
                key: key.clone(),
                name,
                email,
                count: 0,
            })
            .count += 1;

        let day = commit.time().seconds().div_euclid(DAY);
        latest_day = Some(latest_day.map_or(day, |value| value.max(day)));
        let (year, month, _) = civil_from_days(day);
        let month_index = year * 12 + month as i64 - 1;
        earliest_month = Some(earliest_month.map_or(month_index, |value| value.min(month_index)));

        if author_filter
            .as_deref()
            .is_none_or(|selected| selected == key)
        {
            *month_counts.entry(month_index).or_insert(0) += 1;
            *day_counts.entry(day).or_insert(0) += 1;
            total += 1;
        }
    }

    let mut author_list: Vec<AuthorStat> = authors.into_values().collect();
    author_list.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let Some(latest) = latest_day else {
        return Ok(Statistics {
            authors: author_list,
            total_commits: total,
            truncated,
            months: Vec::new(),
            month_days: Vec::new(),
            week_days: Vec::new(),
            months_label: String::new(),
            month_label: String::new(),
            week_label: String::new(),
        });
    };

    let (latest_year, latest_month_num, _) = civil_from_days(latest);
    let latest_month = latest_year * 12 + latest_month_num as i64 - 1;
    let start_month = earliest_month
        .unwrap_or(latest_month)
        .max(latest_month - (MAX_MONTHS - 1));
    let months: Vec<StatBucket> = (start_month..=latest_month)
        .map(|month_index| {
            let year = month_index.div_euclid(12);
            let month = month_index.rem_euclid(12) as u32 + 1;
            StatBucket {
                key: format!("{year}-{month:02}"),
                label: format!("{year}/{month:02}"),
                count: month_counts.get(&month_index).copied().unwrap_or(0),
            }
        })
        .collect();

    let month_days: Vec<StatBucket> = (1..=days_in_month(latest_year, latest_month_num))
        .map(|day| {
            let day_index = days_from_civil(latest_year, latest_month_num, day);
            StatBucket {
                key: format!("{latest_year}-{latest_month_num:02}-{day:02}"),
                label: format!("{latest_month_num:02}/{day:02}"),
                count: day_counts.get(&day_index).copied().unwrap_or(0),
            }
        })
        .collect();

    // 周一为一周起点；WEEK 标签显示最新提交所在自然周。
    let weekday = (latest + 3).rem_euclid(7);
    let week_start = latest - weekday;
    let week_days: Vec<StatBucket> = (0..7)
        .map(|offset| {
            let day_index = week_start + offset;
            let (year, month, day) = civil_from_days(day_index);
            StatBucket {
                key: format!("{year}-{month:02}-{day:02}"),
                label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][offset as usize]
                    .to_string(),
                count: day_counts.get(&day_index).copied().unwrap_or(0),
            }
        })
        .collect();

    let first_month = start_month;
    let first_year = first_month.div_euclid(12);
    let first_month_num = first_month.rem_euclid(12) + 1;
    let (week_end_year, week_end_month, week_end_day) = civil_from_days(week_start + 6);
    let (week_start_year, week_start_month, week_start_day) = civil_from_days(week_start);

    Ok(Statistics {
        authors: author_list,
        total_commits: total,
        truncated,
        months,
        month_days,
        week_days,
        months_label: format!("{first_year}/{first_month_num:02} – {latest_year}/{latest_month_num:02}"),
        month_label: format!("{latest_year}/{latest_month_num:02}"),
        week_label: format!(
            "{week_start_year}/{week_start_month:02}/{week_start_day:02} – {week_end_year}/{week_end_month:02}/{week_end_day:02}"
        ),
    })
}

/// Howard Hinnant 的 civil date 算法：Unix 天数 → (年, 月, 日)，避免引入时区依赖。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if month <= 2 { year + 1 } else { year },
        month as u32,
        day as u32,
    )
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn days_in_month(year: i64, month: u32) -> u32 {
    let next = if month == 12 {
        days_from_civil(year + 1, 1, 1)
    } else {
        days_from_civil(year, month + 1, 1)
    };
    (next - days_from_civil(year, month, 1)) as u32
}

#[cfg(test)]
mod tests {
    use super::{civil_from_days, days_from_civil, days_in_month};

    #[test]
    fn civil_conversions_round_trip() {
        for day in [-719_162, -1, 0, 1, 19_000, 20_700, 30_000] {
            let (year, month, date) = civil_from_days(day);
            assert_eq!(days_from_civil(year, month, date), day);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2025, 2), 28);
        assert_eq!(days_in_month(2026, 11), 30);
    }
}
