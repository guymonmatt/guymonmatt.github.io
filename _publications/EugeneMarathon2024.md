---
title: "Eugene 2024 Marathon Data Analysis"
excerpt: "Scraping and Visualizing result data"
permalink: /Marathon/
author_profile: true


---

After completing the Eugene Marathon in April 2024, I scraped the race data from the results page to further explore the data. The Eugene Marathon has a repuation for attracting elite competitors from beyond just the Pacific Northwest so I went about exploring the scraped dataset with this international interest in mind. I created visualizations using Tableu and provided insights I discovered while working with the result data.

[Click this Link to access the Tableu Dashboard for this Analysis](https://public.tableau.com/views/MarathonDashboard_17158347674300/Dashboard1?:language=en-US&:sid=&:display_count=n&:origin=viz_share_link) 




## Methodology

Using python, I initally scraped that data with a tool called selenium. After correcting column names, I went about cleaning the dataset and fixing/removing null values in the Chip Time column that would have created difficulties for later computations with this column. 

I converted the time based columns such as Pace and Chip Time to a TimeDelta data type. This is because Python doesn't interact well with number that are formatted like 33:27:20. This same value when converted to TimeDelta looks like 0 days 33:27:20. 

I also created a float column called hours that converted finish times into hours with a decimal. This simplified the proccess of later calcualtions and charts.

## Initial Analysis Conducted In Jupiter Notebook

These are graphs from early data exploration. Similar questions are more pursued in greater detail in the Tableu Dashboard.

# Demographic Analysis:

  
- What are the age demographics of participants, does it vary by gender?

![ ](/files/gender_area.png)


- Which countries are most represented in the race?

![ ](/files/country_pie.png)



# Performance Analysis:

-- Are there any correlations between age and finishing time?

![ ](/files/agebox.png)




---


Access the full Jupter Notebook for this analysis [here](https://github.com/guymonmatt/guymonmatt.github.io/blob/master/notebooks/Eugene_Marathon_2024_results.ipynb).
