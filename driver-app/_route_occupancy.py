path = r'w:\Final year project\driver-app\RouteSelectionScreen.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add occupancy state and OCCUPANCIES constant
old1 = "const DIRECTIONS = [\"OUTBOUND\", \"INBOUND\"];"
new1 = "const DIRECTIONS = [\"OUTBOUND\", \"INBOUND\"];\nconst OCCUPANCIES = [\"EMPTY\", \"LOW\", \"MEDIUM\", \"HIGH\", \"FULL\"];"
content = content.replace(old1, new1, 1)

# 2. Add selectedOccupancy state
old2 = "  const [startingShift, setStartingShift] = useState(false);"
new2 = "  const [startingShift, setStartingShift] = useState(false);\n  const [selectedOccupancy, setSelectedOccupancy] = useState(\"MEDIUM\");"
content = content.replace(old2, new2, 1)

# 3. Add occupancy to navParams
old3 = """    const navParams = {
      token,
      routeId: selectedRoute.id,
      routeName: selectedRoute.name,
      routeColor: selectedRoute.color,
      direction: selectedDirection,
    };"""
new3 = """    const navParams = {
      token,
      routeId: selectedRoute.id,
      routeName: selectedRoute.name,
      routeColor: selectedRoute.color,
      direction: selectedDirection,
      occupancy: selectedOccupancy,
    };"""
content = content.replace(old3, new3, 1)

# 4. Add renderOccupancySelector before renderDirectionSelector call or after it
# Insert after renderDirectionSelector function definition
old4 = """  const renderDirectionSelector = () => (
    <View style={styles.directionContainer}>
      <Text style={styles.sectionTitle}>Select Direction</Text>
      <View style={styles.directionButtons}>
        {DIRECTIONS.map((direction) => (
          <TouchableOpacity
            key={direction}
            style={[
              styles.directionButton,
              selectedDirection === direction && styles.directionButtonSelected,
            ]}
            onPress={() => setSelectedDirection(direction)}
          >
            <Text
              style={[
                styles.directionButtonText,
                selectedDirection === direction && styles.directionButtonTextSelected,
              ]}
            >
              {direction}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );"""
new4 = """  const renderOccupancySelector = () => (
    <View style={styles.directionContainer}>
      <Text style={styles.sectionTitle}>Bus Occupancy</Text>
      <View style={styles.directionButtons}>
        {OCCUPANCIES.map((occ) => (
          <TouchableOpacity
            key={occ}
            style={[
              styles.directionButton,
              selectedOccupancy === occ && styles.directionButtonSelected,
            ]}
            onPress={() => setSelectedOccupancy(occ)}
          >
            <Text
              style={[
                styles.directionButtonText,
                selectedOccupancy === occ && styles.directionButtonTextSelected,
              ]}
            >
              {occ}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderDirectionSelector = () => (
    <View style={styles.directionContainer}>
      <Text style={styles.sectionTitle}>Select Direction</Text>
      <View style={styles.directionButtons}>
        {DIRECTIONS.map((direction) => (
          <TouchableOpacity
            key={direction}
            style={[
              styles.directionButton,
              selectedDirection === direction && styles.directionButtonSelected,
            ]}
            onPress={() => setSelectedDirection(direction)}
          >
            <Text
              style={[
                styles.directionButtonText,
                selectedDirection === direction && styles.directionButtonTextSelected,
              ]}
            >
              {direction}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );"""
content = content.replace(old4, new4, 1)

# 5. Add renderOccupancySelector to JSX output
old5 = "      {renderDirectionSelector()}"
new5 = "      {renderOccupancySelector()}\n      {renderDirectionSelector()}"
content = content.replace(old5, new5, 1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('RouteSelectionScreen occupancy added')
